import type { ContentItem, PublishTarget } from '@growth-os/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { channelFor, gql, postInput, sync, type Channel } from '../src/worker/buffer-connector'

type Call = { url: string; method: string; body?: string; auth?: string; source?: string }
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) })

const CHANNELS: Channel[] = [
  { id: 'ch-tt', name: 'tt', service: 'tiktok' },
  { id: 'ch-th', name: 'th', service: 'threads' },
  { id: 'ch-x', name: 'x', service: 'twitter' },
]
const NOW = Date.parse('2026-11-10T12:00:00Z')
const t = (platform: PublishTarget['platform'], over: Partial<PublishTarget> = {}): PublishTarget => ({ platform, caption: `${platform} text`, scheduledAt: '2026-11-10T15:00:00.000Z', status: 'approved', bufferPostId: '', liveUrl: '', error: '', ...over })
const item = (id: string, targets: PublishTarget[], mediaUrl = 'https://media.example.com/clip.mp4') => ({ id, mediaUrl, targets }) as unknown as ContentItem

/** A fake Buffer plus a fake Growth OS endpoint that keeps the items it is sent. */
function fake(items: ContentItem[], buffer: (op: string, variables: Record<string, unknown>) => unknown = () => ({})) {
  const store = new Map(items.map((i) => [i.id, structuredClone(i)]))
  const calls: Call[] = []
  const f = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const c = { url, method: init.method ?? 'GET', body: init.body, auth: init.headers?.authorization, source: init.headers?.['x-growth-source'] }
    calls.push(c)
    if (url === 'https://api.buffer.com') {
      const { query, variables } = JSON.parse(init.body!) as { query: string; variables: Record<string, unknown> }
      const op = /^(query|mutation) (\w+)/.exec(query)![2]
      const custom = buffer(op, variables)
      if (custom && typeof custom === 'object' && 'status' in custom) return reply((custom as { status: number }).status, (custom as { body: unknown }).body)
      const data =
        op === 'Organizations' ? { account: { organizations: [{ id: 'org-1', name: 'Mine' }] } }
        : op === 'Channels' ? { channels: CHANNELS }
        : op === 'CreatePost' ? { createPost: { post: { id: `bp-${(variables.input as { channelId: string }).channelId}` } } }
        : op === 'DeletePost' ? { deletePost: { id: (variables.input as { id: string }).id } }
        : {}
      return reply(200, { data: { ...data, ...(custom as object) } })
    }
    const path = url.replace('http://127.0.0.1:9', '')
    if (path === '/api/content-items') return reply(200, [...store.values()])
    const m = /^\/api\/content\/(.+)$/.exec(path)
    const doc = m && store.get(decodeURIComponent(m[1]))
    if (!doc) return reply(404, {})
    if (c.method === 'PATCH') Object.assign(doc, JSON.parse(init.body!))
    return reply(200, doc)
  }
  return { f, calls, store, bufferCalls: () => calls.filter((c) => c.url === 'https://api.buffer.com').map((c) => JSON.parse(c.body!) as { query: string; variables: { input: Record<string, unknown> } }) }
}

describe('Buffer connector', () => {
  beforeEach(() => Object.assign(process.env, { BUFFER_API_KEY: 'buf-key', GROWTH_OS_CREATOR_KEY: 'creator-key', GROWTH_OS_API: 'http://127.0.0.1:9' }))
  afterEach(() => {
    for (const k of ['BUFFER_API_KEY', 'GROWTH_OS_CREATOR_KEY', 'GROWTH_OS_API', 'BUFFER_ORGANIZATION_ID', 'BUFFER_CHANNEL_X']) delete process.env[k]
  })

  it('picks the only channel per platform, or the configured one, and explains anything else', () => {
    expect(channelFor('x', CHANNELS)).toEqual({ id: 'ch-x' })
    expect(channelFor('x', [...CHANNELS, { id: 'ch-x2', name: 'x2', service: 'twitter' }])).toEqual({ error: expect.stringContaining('BUFFER_CHANNEL_X') })
    expect(channelFor('threads', [])).toEqual({ error: 'No threads channel is connected in Buffer.' })
    process.env.BUFFER_CHANNEL_X = 'ch-x2'
    expect(channelFor('x', [...CHANNELS, { id: 'ch-x2', name: 'x2', service: 'twitter' }])).toEqual({ id: 'ch-x2' })
    process.env.BUFFER_CHANNEL_X = 'missing'
    expect(channelFor('x', CHANNELS)).toEqual({ error: expect.stringContaining('not a channel') })
  })

  it('asks Buffer to publish at the approved time, with the media as a video or an image', () => {
    expect(postInput(t('tiktok'), 'https://m.example.com/a.mp4', 'ch-tt')).toEqual({ text: 'tiktok text', channelId: 'ch-tt', schedulingType: 'automatic', mode: 'customScheduled', dueAt: '2026-11-10T15:00:00.000Z', assets: [{ video: { url: 'https://m.example.com/a.mp4' } }] })
    expect(postInput(t('threads'), 'https://m.example.com/a.JPG?v=1', 'ch-th').assets).toEqual([{ image: { url: 'https://m.example.com/a.JPG?v=1' } }])
    expect(postInput(t('x'), '', 'ch-x').assets).toEqual([])
  })

  it('sync: schedules approved versions, fails late ones, deletes cancelled ones, and records each on the item', async () => {
    const { f, calls, store, bufferCalls } = fake([
      item('C-1', [t('threads'), t('x', { scheduledAt: '2026-11-10T12:00:30.000Z' }), t('tiktok', { status: 'cancelled', bufferPostId: 'bp-old' })]),
      item('C-2', [t('threads', { status: 'draft' }), t('x', { status: 'scheduled', bufferPostId: 'bp-9' })]),
    ])
    const r = await sync(f, NOW)
    expect(r).toEqual({ scheduled: ['C-1 threads'], cancelled: ['C-1 tiktok'], failed: ['C-1 x'], problems: [] })
    const [threads, x, tiktok] = store.get('C-1')!.targets!
    expect(threads).toMatchObject({ status: 'scheduled', bufferPostId: 'bp-ch-th', error: '' })
    expect(x).toMatchObject({ status: 'failed', bufferPostId: '', error: expect.stringContaining('time passed') })
    expect(tiktok).toMatchObject({ status: 'cancelled', bufferPostId: '' })
    expect(store.get('C-2')!.targets).toEqual(item('C-2', [t('threads', { status: 'draft' }), t('x', { status: 'scheduled', bufferPostId: 'bp-9' })]).targets)
    const ops = bufferCalls().map((b) => /^(query|mutation) (\w+)/.exec(b.query)![2])
    expect(ops).toEqual(['Organizations', 'Channels', 'CreatePost', 'DeletePost'])
    expect(bufferCalls()[2].variables.input).toMatchObject({ channelId: 'ch-th', mode: 'customScheduled', dueAt: '2026-11-10T15:00:00.000Z', text: 'threads text' })
    expect(bufferCalls()[3].variables.input).toEqual({ id: 'bp-old' })
    for (const c of calls) expect(c.auth).toBe(c.url.startsWith('https://api.buffer.com') ? 'Bearer buf-key' : 'Bearer creator-key')
    for (const c of calls.filter((x) => x.url.startsWith('http://127.0.0.1'))) expect(c.source).toBe('buffer connector')
  })

  it('sync: nothing approved or cancelled means no Buffer call at all', async () => {
    const { f, bufferCalls } = fake([item('C-1', [t('threads', { status: 'draft' }), t('x', { status: 'sent', bufferPostId: 'b', liveUrl: 'https://x.com/a/status/1' })])])
    expect(await sync(f, NOW)).toEqual({ scheduled: [], cancelled: [], failed: [], problems: [] })
    expect(bufferCalls()).toHaveLength(0)
  })

  it('sync: a Buffer refusal fails that version with Buffer\'s reason and leaves the others', async () => {
    const { f, store } = fake([item('C-1', [t('threads'), t('x')])], (op, v) =>
      op === 'CreatePost' && (v.input as { channelId: string }).channelId === 'ch-x' ? { createPost: { message: 'Text is too long for X' } } : {},
    )
    const r = await sync(f, NOW)
    expect(r.scheduled).toEqual(['C-1 threads'])
    expect(r.failed).toEqual(['C-1 x'])
    expect(store.get('C-1')!.targets![1]).toMatchObject({ status: 'failed', error: 'Buffer did not schedule it: Text is too long for X' })
  })

  it('sync: a version the creator changed meanwhile is left alone, and the orphan Buffer post is reported', async () => {
    const { f, store } = fake([item('C-1', [t('threads')])])
    const raced = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      if (url.endsWith('/api/content/C-1') && (init?.method ?? 'GET') === 'GET') store.get('C-1')!.targets![0].status = 'draft'
      return f(url, init)
    }
    const r = await sync(raced, NOW)
    expect(store.get('C-1')!.targets![0]).toMatchObject({ status: 'draft', bufferPostId: '' })
    expect(r.problems[0]).toMatch(/changed while syncing.*Buffer post bp-ch-th exists/)
  })

  it('reports Buffer errors without echoing the key', async () => {
    const { f } = fake([], () => ({ status: 401, body: { errors: [{ message: 'Invalid API key' }] } }))
    const err = await gql(f, 'query Organizations { account { organizations { id } } }').catch((e: Error) => e.message)
    expect(err).toBe('Buffer: Invalid API key')
    expect(err).not.toContain('buf-key')
  })
})
