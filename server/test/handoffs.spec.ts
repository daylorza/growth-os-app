import type { INestApplication } from '@nestjs/common'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EventsService } from '../src/events/events.module'
import { NOTE_PREFIX } from '../src/worker/threads-connector'
import { as, basic, bearer, contentItem, makeApp } from './helpers'

interface Received {
  path: string
  headers: IncomingMessage['headers']
  body: { event: string; contentItemId: string; handoffId: string; from: string; at: string }
}

/** A stand-in for the agents' webhook listeners. `failFirst` makes the first N calls fail. */
function listener(failFirst = 0) {
  const got: Received[] = []
  let calls = 0
  const server: Server = createServer((req, res) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      calls++
      if (calls <= failFirst) return res.writeHead(503).end()
      got.push({ path: req.url ?? '', headers: req.headers, body: JSON.parse(data) })
      res.writeHead(200).end('{}')
    })
  })
  return { got, server, url: () => `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

const start = (s: Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))

describe('the agent loop: no human step between a brief and an analysis', () => {
  const hooks = listener()
  let app: INestApplication
  let events: EventsService
  const idle = () => events.idle()

  beforeAll(async () => {
    await start(hooks.server)
    app = await makeApp({ webhooks: { analyst: { url: `${hooks.url()}/analyst`, key: 'analyst-hook-key' }, creative: { url: `${hooks.url()}/creative`, key: 'creative-hook-key' } } })
    events = app.get(EventsService)
  })
  afterAll(async () => {
    await app.close()
    hooks.server.close()
  })

  it('runs analysis → brief → approval → publish → measure → result, waking the right agent each time', async () => {
    const analyst = as(app, bearer('analyst'))
    const creative = as(app, bearer('creative'))
    const day = as(app, basic)
    const id = await contentItem(app, 'Agent demo')

    const snap = await analyst.post('/api/audience/snapshots', { platform: 'x', date: '2026-01-01', source: 'audit', sourceType: 'analyst_agent', metrics: { followers: 100 } })
    const analysis = await analyst.post('/api/handoffs', { contentItemId: id, to: 'creative', type: 'analysis', body: 'Demos beat talking heads.', refs: [{ collection: 'audience_snapshots', id: snap.body.id }] })
    expect(analysis.status).toBe(201)
    await idle()
    expect(hooks.got.at(-1)).toMatchObject({ path: '/creative', body: { event: 'analysis_created', contentItemId: id, handoffId: analysis.body.id, from: 'analyst' } })
    expect(hooks.got.at(-1)!.headers).toMatchObject({ authorization: 'Bearer creative-hook-key', 'idempotency-key': analysis.body.id })

    const brief = await creative.post('/api/briefs', { contentItemId: id, sourceHandoffId: analysis.body.id, objective: 'Show the demo' })
    expect(brief.status).toBe(201)
    await idle()
    const briefEvent = hooks.got.at(-1)!
    expect(briefEvent).toMatchObject({ path: '/analyst', body: { event: 'brief_created', contentItemId: id, from: 'creative' } })
    expect(briefEvent.headers.authorization).toBe('Bearer analyst-hook-key')

    // Two hooks and two captions: approval covers every draft for the item, not just the latest.
    await creative.post('/api/hooks', { contentItemId: id, kind: 'outcome', text: 'Demo first' })
    await creative.post('/api/hooks', { contentItemId: id, kind: 'curiosity', text: 'Held for later' })
    await creative.post('/api/captions', { contentItemId: id, platform: 'tiktok', text: 'T' })
    await creative.post('/api/captions', { contentItemId: id, platform: 'x', text: 'X' })
    const decision = await day.post(`/api/content-items/${id}/decision`, { decision: 'approve' })
    expect(decision.status).toBe(201)
    for (const c of ['hooks', 'captions']) expect((await day.get(`/api/${c}?contentItemId=${id}`)).body.map((x: { status: string }) => x.status)).toEqual(['approved', 'approved'])
    // A double click does not write a second approval or send a second event.
    const again = await day.post(`/api/content-items/${id}/decision`, { decision: 'approve' })
    expect(again.body).toMatchObject({ unchanged: true, handoff: { id: decision.body.handoff.id } })
    await idle()
    expect(hooks.got.filter((g) => g.body.event === 'approval_given')).toHaveLength(1)
    expect(hooks.got.at(-1)).toMatchObject({ path: '/creative', body: { event: 'approval_given', from: 'creator' } })
    expect((await day.get(`/api/briefs?contentItemId=${id}`)).body[0].status).toBe('approved')

    await day.patch(`/api/content/${id}`, { status: 'published', url: 'https://example.com/v/9', publishedAt: new Date(Date.now() - 73 * 3_600_000).toISOString() })
    await idle()
    expect(hooks.got.at(-1)).toMatchObject({ path: '/analyst', body: { event: 'post_published' } })

    const measured = await as(app, bearer('worker')).post('/api/dispatch/measure-requests', {})
    expect(measured.body.sent).toEqual([`H-MEASURE-${id}-24h`, `H-MEASURE-${id}-72h`])
    expect((await as(app, bearer('worker')).post('/api/dispatch/measure-requests', {})).body.sent).toEqual([])
    await idle()
    expect(hooks.got.filter((g) => g.body.event === 'measure_request').map((g) => g.body.handoffId)).toEqual([`H-MEASURE-${id}-24h`, `H-MEASURE-${id}-72h`])

    const x = await analyst.post('/api/experiments', { contentItemId: id, hypothesis: 'Demo hook', result: '2x shares' })
    expect(x.status).toBe(201)
    await idle()
    expect(hooks.got.at(-1)).toMatchObject({ path: '/creative', body: { event: 'experiment_logged', contentItemId: id } })

    // The full thread, in order, and the normalised next step.
    const thread = (await day.get(`/api/content-items/${id}/handoffs`)).body as { type: string; from: string }[]
    expect(thread.map((h) => `${h.from}:${h.type}`)).toEqual(['analyst:analysis', 'creative:brief', 'creator:approval', 'creator:question', 'creator:question', 'creator:question', 'analyst:result'])
    const next = (await creative.get(`/api/content-items/${id}/next-step`)).body
    expect(next.latestAnalysis.id).toBe(analysis.body.id)
    expect(next.latestBrief.id).toBe(brief.body.id)
    expect(next.latestResult.type).toBe('result')
    expect(next.recommended).toMatchObject({ owner: 'creative' })
    expect(next.recommended.action).toContain(next.latestResult.id)
  })

  it('daily_audit is idempotent per day: a re-run never creates duplicate work', async () => {
    const worker = as(app, bearer('worker'))
    const a = await worker.post('/api/dispatch/daily-audit', {})
    const b = await worker.post('/api/dispatch/daily-audit', {})
    expect(a.body.handoff.id).toBe(b.body.handoff.id)
    expect(b.body.created).toBe(false)
    await idle()
    expect(hooks.got.filter((g) => g.body.event === 'daily_audit')).toHaveLength(1)
    expect(a.body.handoff).toMatchObject({ to: 'analyst', type: 'question', contentItemId: expect.stringMatching(/^AUDIT-/) })
    expect(a.body.handoff._meta.createdBy).toBe('scheduler')
  })

  it('x_refresh is idempotent per 4-hour UTC window and wakes the analyst', async () => {
    const worker = as(app, bearer('worker'))
    const a = await worker.post('/api/dispatch/x-refresh', {})
    const b = await worker.post('/api/dispatch/x-refresh', {})
    expect(a.status).toBe(201)
    expect(a.body.handoff.id).toMatch(/^H-XREFRESH-\d{4}-\d{2}-\d{2}-(00|04|08|12|16|20)$/)
    expect(b.body).toMatchObject({ created: false, handoff: { id: a.body.handoff.id } })
    expect(a.body.handoff).toMatchObject({ to: 'analyst', type: 'question', contentItemId: expect.stringMatching(/^AUDIT-/) })
    await idle()
    expect(hooks.got.filter((g) => g.body.event === 'x_refresh').map((g) => g.body.handoffId)).toEqual([a.body.handoff.id])
    expect((await as(app, bearer('analyst')).post('/api/dispatch/x-refresh', {})).status).toBe(403)
  })

  it('weekly_refresh asks the creative agent for TikTok and Threads, once per week', async () => {
    const worker = as(app, bearer('worker'))
    const a = await worker.post('/api/dispatch/weekly-refresh', {})
    const b = await worker.post('/api/dispatch/weekly-refresh', {})
    expect(a.status).toBe(201)
    expect(a.body.handoff.id).toMatch(/^H-WEEKLY-\d{4}-\d{2}-\d{2}$/)
    expect(b.body).toMatchObject({ created: false, handoff: { id: a.body.handoff.id } })
    expect(a.body.handoff).toMatchObject({ to: 'creative', type: 'question', contentItemId: expect.stringMatching(/^AUDIT-/) })
    expect(a.body.handoff.body).toMatch(/TikTok.*Threads/)
    await idle()
    expect(hooks.got.filter((g) => g.body.event === 'weekly_refresh').map((g) => g.body.handoffId)).toEqual([a.body.handoff.id])
    expect((await as(app, bearer('creative')).post('/api/dispatch/weekly-refresh', {})).status).toBe(403)
  })

  it('engagement_sweep asks the creative agent to queue new comments, once per 4-hour window', async () => {
    const worker = as(app, bearer('worker'))
    const a = await worker.post('/api/dispatch/engagement-sweep', {})
    const b = await worker.post('/api/dispatch/engagement-sweep', {})
    expect(a.body.handoff.id).toMatch(/^H-SWEEP-\d{4}-\d{2}-\d{2}-(00|04|08|12|16|20)$/)
    expect(b.body).toMatchObject({ created: false, handoff: { id: a.body.handoff.id } })
    expect(a.body.handoff).toMatchObject({ to: 'creative', type: 'question' })
    // The sweep skips Threads replies the Threads connector already queues (its note prefix).
    expect(a.body.handoff.body).toContain(`their note starts with "${NOTE_PREFIX}"`)
    await idle()
    expect(hooks.got.filter((g) => g.body.event === 'engagement_sweep')).toHaveLength(1)
    expect((await as(app, bearer('analyst')).post('/api/dispatch/engagement-sweep', {})).status).toBe(403)
  })

  it('records every event in the outbox with its delivery status', async () => {
    const outbox = (await as(app, basic).get('/api/events')).body as { id: string; status: string; to: string }[]
    expect(outbox.length).toBeGreaterThan(5)
    expect(outbox.every((e) => e.status === 'delivered')).toBe(true)
    expect(new Set(outbox.map((e) => e.id)).size).toBe(outbox.length)
  })
})

describe('webhook delivery', () => {
  it('retries with backoff, then delivers', async () => {
    const flaky = listener(2)
    await start(flaky.server)
    const app = await makeApp({ webhooks: { analyst: { url: flaky.url(), key: '' } } })
    await as(app, bearer('worker')).post('/api/dispatch/daily-audit', {})
    await app.get(EventsService).idle()
    const [e] = (await as(app, basic).get('/api/events')).body
    expect(e).toMatchObject({ status: 'delivered', attempts: 3 })
    expect(flaky.got).toHaveLength(1)
    await app.close()
    flaky.server.close()
  })

  it('gives up after 3 retries and marks the event failed', async () => {
    const down = listener(99)
    await start(down.server)
    const app = await makeApp({ webhooks: { analyst: { url: down.url(), key: '' } } })
    await as(app, bearer('worker')).post('/api/dispatch/daily-audit', {})
    await app.get(EventsService).idle()
    const [e] = (await as(app, basic).get('/api/events')).body
    expect(e).toMatchObject({ status: 'failed', attempts: 4, lastError: 'HTTP 503' })
    await app.close()
    down.server.close()
  })

  it('a recipient without a listener reads the API instead (no_listener)', async () => {
    const app = await makeApp()
    const id = await contentItem(app)
    const snap = await as(app, bearer('analyst')).post('/api/audience/snapshots', { platform: 'x', date: '2026-01-01', source: 'a', metrics: { followers: 1 } })
    await as(app, bearer('analyst')).post('/api/handoffs', { contentItemId: id, to: 'creative', type: 'analysis', body: 'x', refs: [{ collection: 'audience_snapshots', id: snap.body.id }] })
    const [e] = (await as(app, basic).get('/api/events')).body
    expect(e).toMatchObject({ status: 'no_listener', to: 'creative', payload: { event: 'analysis_created' } })
    expect((await as(app, bearer('creative')).get('/api/handoffs?acknowledged=false&to=creative')).body).toHaveLength(1)
    await app.close()
  })
})

describe('shared memory: no analysis or brief without a cited source', () => {
  let app: INestApplication
  let id: string
  beforeAll(async () => {
    app = await makeApp()
    id = await contentItem(app)
  })
  afterAll(() => app.close())

  it('an analysis must cite snapshots or experiments that exist', async () => {
    const analyst = as(app, bearer('analyst'))
    expect((await analyst.post('/api/handoffs', { contentItemId: id, to: 'creative', type: 'analysis', body: 'x' })).status).toBe(400)
    expect((await analyst.post('/api/handoffs', { contentItemId: id, to: 'creative', type: 'analysis', body: 'x', refs: [{ collection: 'audience_snapshots', id: 'S-404' }] })).status).toBe(400)
  })

  it('a brief must cite an analysis handoff', async () => {
    const creative = as(app, bearer('creative'))
    expect((await creative.post('/api/briefs', { contentItemId: id, objective: 'x' })).status).toBe(400)
    const q = await creative.post('/api/handoffs', { contentItemId: id, to: 'analyst', type: 'question', body: 'Data?' })
    expect((await creative.post('/api/briefs', { contentItemId: id, sourceHandoffId: q.body.id })).status).toBe(400)
    expect((await creative.post('/api/handoffs', { contentItemId: id, to: 'analyst', type: 'brief', body: 'x', refs: [{ collection: 'handoffs', id: q.body.id }] })).status).toBe(400)
  })
})

describe('every handoff and snapshot has its item ID, author and timestamp', () => {
  let app: INestApplication
  beforeAll(async () => {
    app = await makeApp()
  })
  afterAll(() => app.close())

  it('rejects a handoff without an item ID, or with one that does not exist', async () => {
    const day = as(app, basic)
    expect((await day.post('/api/handoffs', { to: 'analyst', type: 'question', body: 'x' })).status).toBe(400)
    expect((await day.post('/api/handoffs', { contentItemId: '', to: 'analyst', type: 'question', body: 'x' })).status).toBe(400)
    expect((await day.post('/api/handoffs', { contentItemId: 'C-404', to: 'analyst', type: 'question', body: 'x' })).status).toBe(400)
    expect((await day.post('/api/handoffs', { contentItemId: 'AUDIT-2026-01-01', to: 'analyst', type: 'question', body: 'x' })).status).toBe(201)
  })

  it('rejects a snapshot without a date or source', async () => {
    const analyst = as(app, bearer('analyst'))
    expect((await analyst.post('/api/audience/snapshots', { platform: 'x', source: 'a', metrics: {} })).status).toBe(400)
    expect((await analyst.post('/api/audience/snapshots', { platform: 'x', date: '2026-01-01', metrics: {} })).status).toBe(400)
  })

  it('stamps author and time on everything written, and the body cannot forge them', async () => {
    const id = await contentItem(app)
    const analyst = as(app, bearer('analyst'))
    expect((await analyst.post('/api/handoffs', { contentItemId: id, to: 'creative', type: 'question', body: 'x', _meta: { createdBy: 'someone' } })).status).toBe(400)
    await analyst.post('/api/audience/snapshots', { platform: 'tiktok', date: '2026-01-01', source: 'export', metrics: { followers: 3 } })
    await analyst.post('/api/handoffs', { contentItemId: id, to: 'creative', type: 'question', body: 'x' })
    await as(app, bearer('worker')).post('/api/dispatch/daily-audit', {})
    const handoffs = (await as(app, basic).get('/api/handoffs')).body as Record<string, any>[]
    const snapshots = (await as(app, basic).get('/api/audience/snapshots')).body as Record<string, any>[]
    expect(handoffs.length).toBeGreaterThanOrEqual(3)
    for (const h of handoffs) {
      expect(h.contentItemId, h.id).toMatch(/\S/)
      expect(h.createdAt, h.id).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(h._meta?.createdBy, h.id).toMatch(/\S/)
      expect(h.from, h.id).toMatch(/^(creator|analyst|creative)$/)
    }
    for (const s of snapshots) {
      expect(s.id).toMatch(/\S/)
      expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(s._meta?.createdBy).toBe('analyst-agent')
      expect(s._meta?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
  })
})

describe('next step', () => {
  it('recommends the analyst first, then the brief, then the creator', async () => {
    const app = await makeApp()
    const id = await contentItem(app)
    const get = async () => (await as(app, basic).get(`/api/content-items/${id}/next-step`)).body
    expect((await get()).recommended.owner).toBe('analyst')
    const snap = await as(app, bearer('analyst')).post('/api/audience/snapshots', { platform: 'x', date: '2026-01-01', source: 'a', metrics: { followers: 1 } })
    const a = await as(app, bearer('analyst')).post('/api/handoffs', { contentItemId: id, to: 'creative', type: 'analysis', body: 'x', refs: [{ collection: 'audience_snapshots', id: snap.body.id }] })
    expect((await get()).recommended).toEqual({ owner: 'creative', action: `Write a brief that cites ${a.body.id}.` })
    await as(app, bearer('creative')).post('/api/briefs', { contentItemId: id, sourceHandoffId: a.body.id })
    expect((await get()).recommended.owner).toBe('creator')
    await as(app, basic).post(`/api/content-items/${id}/decision`, { decision: 'request_changes', note: 'Shorter hook' })
    expect((await get()).recommended.owner).toBe('creative')
    await as(app, basic).post(`/api/content-items/${id}/decision`, { decision: 'kill' })
    const killed = await get()
    expect(killed.contentItem.status).toBe('killed')
    expect(killed.latestBrief.status).toBe('killed')
    await app.close()
  })
})
