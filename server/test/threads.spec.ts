import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authorizeUrl, exchangeCode, freshToken, NOTE_PREFIX, pull, queueItems, readToken, THREADS, writeToken, type ThreadsReply, type Token } from '../src/worker/threads-connector'

type Call = { url: string; method: string; body?: string; auth?: string; source?: string }
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) })
const DAY = 86_400_000
const NOW = Date.parse('2026-11-10T12:00:00Z')

function fakeFetch(routes: (c: Call) => { status: number; body: unknown }) {
  const calls: Call[] = []
  const f = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const c = { url, method: init.method ?? 'GET', body: init.body, auth: init.headers?.authorization, source: init.headers?.['x-growth-source'] }
    calls.push(c)
    const r = routes(c)
    return reply(r.status, r.body)
  }
  return { f, calls }
}
const query = (url: string) => Object.fromEntries(new URL(url).searchParams)
const token = (over: Partial<Token> = {}): Token => ({ accessToken: 'th.long', userId: 'u1', expiresAt: NOW + 50 * DAY, issuedAt: NOW - 10 * DAY, ...over })
const r = (id: string, over: Partial<ThreadsReply> = {}): ThreadsReply => ({ id, text: `reply ${id}`, username: `fan${id}`, permalink: `https://example.com/@fan${id}/post/${id}`, timestamp: '2026-11-09T10:00:00+0000', replied_to: { id: 'p1' }, is_reply_owned_by_me: false, hide_status: 'NOT_HUSHED', ...over })
const post = { id: 'p1', permalink: 'https://example.com/@me/post/p1', username: 'me', timestamp: '2026-11-08T10:00:00+0000' }

describe('Threads connector (read-only)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'th-'))
    Object.assign(process.env, { THREADS_TOKEN_FILE: join(dir, 'token.json'), THREADS_APP_ID: 'app1', THREADS_APP_SECRET: 'secret1', THREADS_REDIRECT_URI: 'https://host/cb/', GROWTH_OS_CREATOR_KEY: 'creator-key', GROWTH_OS_API: 'http://127.0.0.1:9' })
  })
  afterEach(() => {
    for (const k of ['THREADS_TOKEN_FILE', 'THREADS_APP_ID', 'THREADS_APP_SECRET', 'THREADS_REDIRECT_URI', 'GROWTH_OS_CREATOR_KEY', 'GROWTH_OS_API', 'THREADS_LOOKBACK_DAYS']) delete process.env[k]
  })

  it('asks only for threads_basic and threads_read_replies', () => {
    const q = query(authorizeUrl('app1', 'https://host/cb/', 's1'))
    expect(q).toEqual({ client_id: 'app1', redirect_uri: 'https://host/cb/', scope: 'threads_basic,threads_read_replies', response_type: 'code', state: 's1' })
  })

  it('exchanges the code for a short-lived token, then a 60-day token, and errors never echo the secret', async () => {
    const { f, calls } = fakeFetch((c) =>
      c.url === THREADS.token ? { status: 200, body: { access_token: 'th.short', user_id: 42 } } : { status: 200, body: { access_token: 'th.long', expires_in: 5_184_000 } },
    )
    const t = await exchangeCode(f, 'code1', NOW)
    expect(t).toEqual({ accessToken: 'th.long', userId: '42', expiresAt: NOW + 5_184_000_000, issuedAt: NOW })
    expect(calls[0]).toMatchObject({ url: THREADS.token, method: 'POST' })
    expect(Object.fromEntries(new URLSearchParams(calls[0].body))).toEqual({ client_id: 'app1', client_secret: 'secret1', grant_type: 'authorization_code', redirect_uri: 'https://host/cb/', code: 'code1' })
    expect(calls[1].url.startsWith(`${THREADS.longLived}?`)).toBe(true)
    expect(query(calls[1].url)).toMatchObject({ grant_type: 'th_exchange_token', access_token: 'th.short' })
    const bad = fakeFetch(() => ({ status: 400, body: { error_type: 'OAuthException', code: 400, error_message: 'Matching code was not found or was already used' } }))
    const err = await exchangeCode(bad.f, 'used').catch((e: Error) => e.message)
    expect(err).toBe('Threads: Matching code was not found or was already used')
    expect(err).not.toContain('secret1')
  })

  it('refreshes only a day-old token with under 30 days left, saves it, and stops at expiry', async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, body: { access_token: 'th.new', expires_in: 5_184_000 } }))
    const saved: Token[] = []
    expect(await freshToken(f, token(), (t) => saved.push(t), NOW)).toEqual(token())
    expect(await freshToken(f, token({ expiresAt: NOW + 10 * DAY, issuedAt: NOW - 3_600_000 }), (t) => saved.push(t), NOW)).toMatchObject({ accessToken: 'th.long' })
    expect(calls).toHaveLength(0)
    const next = await freshToken(f, token({ expiresAt: NOW + 10 * DAY }), (t) => saved.push(t), NOW)
    expect(next).toEqual({ accessToken: 'th.new', userId: 'u1', expiresAt: NOW + 5_184_000_000, issuedAt: NOW })
    expect(saved).toEqual([next])
    expect(query(calls[0].url)).toEqual({ grant_type: 'th_refresh_token', access_token: 'th.long' })
    await expect(freshToken(f, token({ expiresAt: NOW - 1 }), () => {}, NOW)).rejects.toThrow(/expired.*\/start/)
  })

  it('stores the token for the connector user only', () => {
    writeToken(token())
    expect(readToken()).toEqual(token())
    expect(statSync(join(dir, 'token.json')).mode & 0o777).toBe(0o600)
  })

  it('queues new replies as drafts; skips her own, hidden and known ones; marks ones she answered as dismissed', () => {
    const replies = [
      r('1'),
      r('2', { hide_status: 'HIDDEN' }),
      r('3', { is_reply_owned_by_me: true, username: 'me', replied_to: { id: '4' }, timestamp: '2026-11-09T12:00:00+0000' }),
      r('4'),
      r('5', { text: '  ' }),
      r('6', { permalink: undefined }),
      r('7'),
      r('8', { text: 'Same words' }),
    ]
    const existing = [{ note: `${NOTE_PREFIX} (reply 7), 2026-11-09.` }, { platform: 'threads', author: '@FAN8', comment: 'Same words', sourcePost: 'https://example.com/@me/post/p1' }]
    const items = queueItems(post, replies, existing, NOW)
    expect(items).toEqual([
      { platform: 'threads', account: '@me', sourcePost: 'https://example.com/@fan1/post/1', author: '@fan1', comment: 'reply 1', channel: 'comment', note: `${NOTE_PREFIX} (reply 1), 2026-11-10.` },
      { platform: 'threads', account: '@me', sourcePost: 'https://example.com/@fan4/post/4', author: '@fan4', comment: 'reply 4', channel: 'comment', status: 'dismissed', note: `${NOTE_PREFIX} (reply 4), 2026-11-10. Already replied by the creator, 2026-11-09.` },
      { platform: 'threads', account: '@me', sourcePost: post.permalink, author: '@fan6', comment: 'reply 6', channel: 'comment', note: `${NOTE_PREFIX} (reply 6), 2026-11-10.` },
    ])
    for (const i of items) expect(i).not.toHaveProperty('draftReply')
  })

  it('pull: reads recent posts and their conversations (paged), queues each new reply once, and a re-run adds nothing', async () => {
    process.env.THREADS_LOOKBACK_DAYS = '3'
    writeToken(token())
    const queue: Record<string, unknown>[] = []
    const { f, calls } = fakeFetch((c) => {
      if (c.url.startsWith(`${THREADS.myPosts}?`)) return { status: 200, body: { data: [post, { ...post, id: 'p2', permalink: 'https://example.com/@me/post/p2' }], paging: { cursors: { after: 'A' } } } }
      if (c.url.startsWith(`${THREADS.media}p1/conversation?`))
        return query(c.url).after ? { status: 200, body: { data: [r('11')], paging: { cursors: { after: 'C' } } } } : { status: 200, body: { data: [r('10')], paging: { cursors: { after: 'B' }, next: 'more' } } }
      if (c.url.startsWith(`${THREADS.media}p2/conversation?`)) return { status: 400, body: { error: { message: 'Unsupported get request', code: 100 } } }
      if (c.url === 'http://127.0.0.1:9/api/engagement-queue') {
        if (c.method === 'POST') queue.push(JSON.parse(c.body!))
        return { status: c.method === 'POST' ? 201 : 200, body: c.method === 'POST' ? {} : queue }
      }
      return { status: 404, body: {} }
    })
    const out = await pull(f, NOW)
    expect(out).toEqual({ posts: 2, replies: 2, queued: 2, alreadyAnswered: 0, problems: ['post p2: Threads: Unsupported get request'] })
    expect(queue.map((q) => q.comment)).toEqual(['reply 10', 'reply 11'])
    const postsCall = query(calls[0].url)
    expect(postsCall).toMatchObject({ fields: 'id,permalink,username,timestamp', since: String(Math.floor((NOW - 3 * DAY) / 1000)), access_token: 'th.long' })
    const threadsCalls = calls.filter((c) => !c.url.startsWith('http://127.0.0.1'))
    expect(threadsCalls.every((c) => c.method === 'GET')).toBe(true)
    expect(threadsCalls.every((c) => c.url.startsWith(`${THREADS.myPosts}?`) || /\/conversation\?/.test(c.url))).toBe(true)
    for (const c of calls.filter((x) => x.url.startsWith('http://127.0.0.1'))) expect(c).toMatchObject({ auth: 'Bearer creator-key', source: 'threads connector' })
    expect((await pull(f, NOW)).queued).toBe(0)
    expect(queue).toHaveLength(2)
  })

  it('pull without an authorization says where to start', async () => {
    const { f } = fakeFetch(() => ({ status: 200, body: {} }))
    await expect(pull(f, NOW)).rejects.toThrow(/No Threads authorization yet/)
  })
})
