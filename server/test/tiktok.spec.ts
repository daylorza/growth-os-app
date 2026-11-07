import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authorizeUrl, contentMetricsFrom, freshToken, listVideos, parseToken, pull, readToken, snapshotFrom, videoIdFromUrl, writeToken, type Token } from '../src/worker/tiktok-connector'

type Call = { url: string; method: string; body?: string; auth?: string }
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) })

function fakeFetch(routes: (c: Call) => { status: number; body: unknown }) {
  const calls: Call[] = []
  const f = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const c = { url, method: init.method ?? 'GET', body: init.body, auth: init.headers?.authorization }
    calls.push(c)
    const r = routes(c)
    return reply(r.status, r.body)
  }
  return { f, calls }
}

const token = (over: Partial<Token> = {}): Token => ({ accessToken: 'act.old', refreshToken: 'rft.old', openId: 'o1', scope: 'user.info.stats,video.list', expiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 86_400_000, ...over })

describe('TikTok connector (read-only)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tt-'))
    Object.assign(process.env, { TIKTOK_TOKEN_FILE: join(dir, 'token.json'), TIKTOK_CLIENT_KEY: 'ck', TIKTOK_CLIENT_SECRET: 'cs', TIKTOK_REDIRECT_URI: 'https://host/cb/', GROWTH_OS_CREATOR_KEY: 'creator-key', GROWTH_OS_API: 'http://127.0.0.1:9' })
  })
  afterEach(() => {
    for (const k of ['TIKTOK_TOKEN_FILE', 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI', 'GROWTH_OS_CREATOR_KEY', 'GROWTH_OS_API']) delete process.env[k]
  })

  it('asks only for read scopes, with a state token and no secret in the URL', () => {
    const u = new URL(authorizeUrl('ck', 'https://host/cb/', 'st4te'))
    expect(u.searchParams.get('scope')).toBe('user.info.basic,user.info.profile,user.info.stats,video.list')
    expect(u.searchParams.get('state')).toBe('st4te')
    expect(u.toString()).not.toContain('cs')
  })

  it('maps counts TikTok returned and leaves the rest UNKNOWN, never 0', () => {
    expect(snapshotFrom({ follower_count: 372, video_count: 9 }, '2026-11-08')).toMatchObject({ id: 'S-TT-API-2026-11-08', platform: 'tiktok', sourceType: 'platform_api', verified: true, metrics: { followers: 372, posts: 9 } })
    expect(snapshotFrom({ follower_count: 372 }, '2026-11-08').metrics).not.toHaveProperty('following')
    expect(videoIdFromUrl('https://www.tiktok.com/@someone/video/7432100000000000001')).toBe('7432100000000000001')
    expect(contentMetricsFrom({ id: '1', view_count: 500, share_count: 3 }, { avgWatchSec: 4.2 }, 'T')).toEqual({ avgWatchSec: 4.2, views: 500, shares: 3, measuredAt: 'T', source: 'TikTok Display API (video.list)' })
  })

  it('reports a token error without echoing the request', () => {
    expect(() => parseToken({ error: 'invalid_grant', error_description: 'bad code' })).toThrow('TikTok token error: invalid_grant bad code')
  })

  it('refreshes near expiry and saves the rotated refresh token', async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, body: { access_token: 'act.new', refresh_token: 'rft.new', expires_in: 7200, refresh_expires_in: 15_552_000, open_id: 'o1', scope: 's' } }))
    let saved: Token | null = null
    const t = await freshToken(f, token({ expiresAt: Date.now() + 60_000 }), (x) => (saved = x))
    expect(t.accessToken).toBe('act.new')
    expect(saved!.refreshToken).toBe('rft.new')
    expect(calls[0].body).toContain('grant_type=refresh_token')
    expect(calls[0].body).toContain('refresh_token=rft.old')
    await expect(freshToken(f, token({ expiresAt: 0, refreshExpiresAt: Date.now() - 1 }), () => {})).rejects.toThrow('authorize again')
  })

  it('stores the token readable by its owner only', () => {
    writeToken(token())
    expect(readToken()?.accessToken).toBe('act.old')
    expect(statSync(process.env.TIKTOK_TOKEN_FILE!).mode & 0o077).toBe(0)
  })

  it('pull: one snapshot and metrics for matching content, all as the creator', async () => {
    const now = Date.parse('2026-11-08T07:30:00Z')
    writeToken(token({ expiresAt: now + 3_600_000, refreshExpiresAt: now + 86_400_000 }))
    const { f, calls } = fakeFetch((c) => {
      if (c.url.startsWith('https://open.tiktokapis.com/v2/user/info/')) return { status: 200, body: { data: { user: { follower_count: 380, following_count: 12, video_count: 10 } }, error: { code: 'ok' } } }
      if (c.url.startsWith('https://open.tiktokapis.com/v2/video/list/')) return { status: 200, body: { data: { videos: [{ id: '777', view_count: 1200, comment_count: 4, share_count: 9 }], has_more: false }, error: { code: 'ok' } } }
      if (c.url.endsWith('/api/audience/snapshots')) return { status: 201, body: {} }
      if (c.url.endsWith('/api/content-items')) return { status: 200, body: [{ id: 'C-1', platform: 'tiktok', url: 'https://www.tiktok.com/@a/video/777', metrics: { follows: 2 } }, { id: 'C-2', platform: 'x', url: 'https://x.com/a/status/777' }] }
      if (c.url.endsWith('/api/content/C-1')) return { status: 200, body: {} }
      return { status: 404, body: {} }
    })
    const r = await pull(f, now)
    expect(r).toMatchObject({ snapshot: 'S-TT-API-2026-11-08', videos: 1, contentUpdated: ['C-1'] })
    const snap = JSON.parse(calls.find((c) => c.url.endsWith('/api/audience/snapshots'))!.body!)
    expect(snap.metrics).toEqual({ followers: 380, following: 12, posts: 10 })
    const patch = JSON.parse(calls.find((c) => c.url.endsWith('/api/content/C-1'))!.body!)
    expect(patch.metrics).toMatchObject({ follows: 2, views: 1200, comments: 4, shares: 9 })
    for (const c of calls.filter((x) => x.url.startsWith('http://127.0.0.1'))) expect(c.auth).toBe('Bearer creator-key')
    for (const c of calls.filter((x) => x.url.includes('tiktokapis'))) expect(c.auth).toBe('Bearer act.old')
    expect(calls.some((c) => c.url.endsWith('/api/content/C-2'))).toBe(false)
    expect(readFileSync(process.env.TIKTOK_TOKEN_FILE!, 'utf8')).toContain('act.old')
  })

  it('follows the page cursor until TikTok says there is no more', async () => {
    const { f, calls } = fakeFetch((c) => {
      const page = JSON.parse(c.body ?? '{}').cursor ?? 0
      return { status: 200, body: { data: { videos: [{ id: `v${page}` }], has_more: page < 2, cursor: page + 1 }, error: { code: 'ok' } } }
    })
    expect((await listVideos(f, 'act')).map((v) => v.id)).toEqual(['v0', 'v1', 'v2'])
    expect(calls).toHaveLength(3)
  })

  it('pull: a second run the same day keeps the first snapshot', async () => {
    writeToken(token())
    const { f } = fakeFetch((c) =>
      c.url.includes('user/info') ? { status: 200, body: { data: { user: { follower_count: 1 } }, error: { code: 'ok' } } }
      : c.url.includes('video/list') ? { status: 200, body: { data: { videos: [] }, error: { code: 'ok' } } }
      : c.url.endsWith('/api/audience/snapshots') ? { status: 409, body: {} }
      : { status: 200, body: [] },
    )
    expect((await pull(f)).snapshot).toContain('already recorded today')
  })
})
