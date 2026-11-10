import type { INestApplication } from '@nestjs/common'
import { ROUTES } from '@growth-os/contracts'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, basic, bearer, contentItem, makeApp, routes } from './helpers'

const srcDir = join(__dirname, '..', 'src')
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith('.ts') ? [p] : []
  })
const PLATFORM_HOSTS = /tiktok\.com|tiktokapis\.com|twitter\.com|api\.x\.com|upload\.x\.com|\/\/x\.com|instagram\.com|facebook\.com|graph\.|threads\.net|linkedin\.com|youtube\.com|googleapis\.com|buffer(app)?\.com/
const bufferFile = join(srcDir, 'worker', 'buffer-connector.ts')
/** The only Buffer mutations the connector may send: schedule, edit or cancel a creator-approved platform version. */
const BUFFER_MUTATIONS = ['createPost', 'deletePost', 'editPost']

describe('draft-only', () => {
  let app: INestApplication
  beforeAll(async () => {
    app = await makeApp()
  })
  afterAll(() => app.close())

  it('serves exactly the contract route table, and none of the routes publish, post, reply, send or message', () => {
    const actual = routes(app).map((r) => `${r.method} ${r.path}`)
    const contract = ROUTES.map((r) => `${r.method} ${r.path.replace(/\{(\w+)\}/g, ':$1')}`)
    expect([...actual].sort()).toEqual([...contract].sort())
    for (const r of actual) expect(r).not.toMatch(/publish|\/post\b|reply|send|message|tweet|\bdm\b|like|follow|share|upload/i)
  })

  it('only the webhook outbox and the workers make outbound calls; only the TikTok and Buffer connectors reach a platform', () => {
    const files = sourceFiles(srcDir)
    const outbound = files.filter((f) => /\bfetch\(|fetch as |from 'node:https?'|axios|undici/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(srcDir.length + 1))
    expect(outbound.sort()).toEqual(['events/events.module.ts', 'worker/buffer-connector.ts', 'worker/dispatch-worker.ts', 'worker/tiktok-connector.ts'])
    expect(files.filter((f) => PLATFORM_HOSTS.test(readFileSync(f, 'utf8'))).map((f) => f.slice(srcDir.length + 1)).sort()).toEqual(['worker/buffer-connector.ts', 'worker/tiktok-connector.ts'])
  })

  it('the scheduler only calls this endpoint: no model or platform API', () => {
    const worker = readFileSync(join(srcDir, 'worker', 'dispatch-worker.ts'), 'utf8')
    expect(new Set([...worker.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]))).toEqual(new Set(['127.0.0.1']))
    expect(worker).not.toMatch(/x\.ai|openai|anthropic/)
  })

  it('the TikTok connector calls only the OAuth token endpoint and Display API reads', () => {
    const src = readFileSync(join(srcDir, 'worker', 'tiktok-connector.ts'), 'utf8')
    const urls = new Set([...src.matchAll(/https:\/\/[a-z0-9.-]*tiktok[a-z0-9.-]*\.com[^'"`\s]*/gi)].map((m) => m[0]))
    expect(urls).toEqual(new Set(['https://www.tiktok.com/v2/auth/authorize/', 'https://open.tiktokapis.com/v2/oauth/token/', 'https://open.tiktokapis.com/v2/user/info/', 'https://open.tiktokapis.com/v2/video/list/']))
    expect(src).not.toMatch(/\/v2\/post\/|\/(publish|upload|comment|like|follow|message|dm)\//i)
    expect(new Set([...src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]))).toEqual(new Set(['www.tiktok.com', 'open.tiktokapis.com', '127.0.0.1', 'localhost']))
  })

  it('the Buffer connector calls only api.buffer.com and this endpoint, and sends only schedule, edit or cancel mutations', () => {
    const src = readFileSync(bufferFile, 'utf8')
    expect(new Set([...src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]))).toEqual(new Set(['api.buffer.com', '127.0.0.1']))
    const mutations = [...src.matchAll(/mutation\s*\w*\s*(?:\([^)]*\))?\s*\{\s*(\w+)/g)].map((m) => m[1])
    expect(mutations.length).toBeGreaterThan(0)
    for (const m of mutations) expect(BUFFER_MUTATIONS).toContain(m)
  })

  it('agents cannot approve, schedule, kill or log content as published', async () => {
    const agent = as(app, bearer('creative'))
    const { body } = await agent.post('/api/content', { title: 'Hook test' })
    expect((await agent.patch(`/api/content/${body.id}`, { approval: 'approved' })).status).toBe(403)
    expect((await agent.patch(`/api/content/${body.id}`, { status: 'scheduled' })).status).toBe(403)
    expect((await agent.patch(`/api/content/${body.id}`, { status: 'killed' })).status).toBe(403)
    expect((await agent.patch(`/api/content/${body.id}`, { status: 'published', url: 'https://example.com/v/1' })).status).toBe(403)
    expect((await agent.post('/api/content', { title: 'x', approval: 'approved' })).status).toBe(403)
    expect((await agent.post(`/api/content-items/${body.id}/decision`, { decision: 'approve' })).status).toBe(403)
  })

  it('even the creator can only log published with approval and a live URL', async () => {
    const day = as(app, basic)
    const { body } = await day.post('/api/content', { title: 'Demo' })
    expect((await day.patch(`/api/content/${body.id}`, { status: 'published' })).status).toBe(400)
    expect((await day.patch(`/api/content/${body.id}`, { approval: 'approved', status: 'published' })).status).toBe(400)
    const ok = await day.patch(`/api/content/${body.id}`, { approval: 'approved', status: 'published', url: 'https://example.com/v/2' })
    expect(ok.status).toBe(200)
    expect(ok.body.publishedAt).toMatch(/^\d{4}-/)
  })

  it('agents draft replies but cannot approve them or log them as posted; sensitive comments are never approved', async () => {
    const agent = as(app, bearer('analyst'))
    const { body } = await agent.post('/api/engagement-queue', { comment: 'How did you build this?', draftReply: 'Thanks!' })
    expect(body.status).toBe('new')
    expect((await agent.patch(`/api/engagement-queue/${body.id}`, { status: 'drafted' })).status).toBe(200)
    expect((await agent.patch(`/api/engagement-queue/${body.id}`, { status: 'approved' })).status).toBe(403)
    expect((await agent.patch(`/api/engagement-queue/${body.id}`, { status: 'posted_by_day' })).status).toBe(403)
    const s = await agent.post('/api/engagement-queue', { comment: 'threat', category: 'sensitive', draftReply: 'x' })
    expect((await as(app, basic).patch(`/api/engagement-queue/${s.body.id}`, { status: 'approved' })).status).toBe(400)
  })

  it('the creative agent queues TikTok and Threads comments only, and cannot approve or log a reply', async () => {
    const creative = as(app, bearer('creative'))
    const t = await creative.post('/api/engagement-queue', { platform: 'threads', author: 'someone', comment: 'How?', draftReply: 'Thanks!' })
    expect(t.status).toBe(201)
    expect(t.body.status).toBe('new')
    expect((await creative.post('/api/engagement-queue', { platform: 'tiktok', comment: 'Nice' })).status).toBe(201)
    const ig = await creative.post('/api/engagement-queue', { platform: 'instagram', account: '@brand', author: 'someone', comment: 'Link?' })
    expect(ig.status).toBe(201)
    expect(ig.body).toMatchObject({ platform: 'instagram', account: '@brand' })
    expect((await creative.post('/api/audience/snapshots', { platform: 'instagram', date: '2026-01-01', source: 'x', metrics: {} })).status).toBe(400)
    expect((await creative.post('/api/engagement-queue', { platform: 'x', comment: 'Nice' })).status).toBe(403)
    expect((await creative.patch(`/api/engagement-queue/${t.body.id}`, { platform: 'x' })).status).toBe(403)
    expect((await creative.patch(`/api/engagement-queue/${t.body.id}`, { status: 'drafted' })).status).toBe(200)
    expect((await creative.patch(`/api/engagement-queue/${t.body.id}`, { status: 'approved' })).status).toBe(403)
    expect((await creative.patch(`/api/engagement-queue/${t.body.id}`, { status: 'posted_by_day' })).status).toBe(403)
  })

  it('the creative agent marks an approved reply sent only after the creator asked it to send that exact text', async () => {
    const day = as(app, basic)
    const creative = as(app, bearer('creative'))
    const { body: e } = await creative.post('/api/engagement-queue', { platform: 'tiktok', author: 'fan', comment: 'How?', draftReply: 'Here is how.' })
    const sent = (id = e.id, extra = {}) => creative.patch(`/api/engagement-queue/${id}`, { status: 'sent_by_agent', ...extra })
    expect((await sent()).status).toBe(403)
    expect((await day.patch(`/api/engagement-queue/${e.id}`, { status: 'approved' })).status).toBe(200)
    expect((await sent()).status).toBe(403)
    const ask = (text: string) => day.post('/api/handoffs', { contentItemId: 'AUDIT-2026-01-01', from: 'creator', to: 'creative', type: 'question', body: `Send exactly this text, once:\n\n${text}`, refs: [{ collection: 'engagement_queue', id: e.id }] })
    expect((await ask('An older reply.')).status).toBe(201)
    expect((await sent()).status).toBe(403)
    expect((await ask('Here is how.')).status).toBe(201)
    expect((await as(app, bearer('analyst')).patch(`/api/engagement-queue/${e.id}`, { status: 'sent_by_agent' })).status).toBe(403)
    expect((await day.patch(`/api/engagement-queue/${e.id}`, { status: 'sent_by_agent' })).status).toBe(403)
    expect((await sent(e.id, { draftReply: 'Something else.' })).status).toBe(400)
    const ok = await sent(e.id, { note: 'Sent by the creative agent, 2026-01-01 10:00' })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ status: 'sent_by_agent', draftReply: 'Here is how.' })
  })

  it('agent drafts stay drafts until the creator decides', async () => {
    const id = await contentItem(app)
    const creative = as(app, bearer('creative'))
    expect((await creative.post('/api/hooks', { contentItemId: id, kind: 'opinion', text: 'Hot take', status: 'approved' })).status).toBe(403)
    const hook = await creative.post('/api/hooks', { contentItemId: id, kind: 'opinion', text: 'Hot take' })
    expect(hook.body.status).toBe('draft')
    expect((await creative.patch(`/api/hooks/${hook.body.id}`, { status: 'approved' })).status).toBe(403)
  })

  it('revenue only counts with evidence, and only the creator attributes it', async () => {
    const day = as(app, basic)
    const { body } = await as(app, bearer('analyst')).post('/api/leads', { summary: 'Inquiry' })
    expect((await as(app, bearer('analyst')).patch(`/api/leads/${body.id}`, { attributedRevenue: 100, revenueEvidence: 'invoice' })).status).toBe(403)
    expect((await day.patch(`/api/leads/${body.id}`, { attributedRevenue: 100 })).status).toBe(400)
    expect((await day.patch(`/api/leads/${body.id}`, { attributedRevenue: 100, revenueEvidence: 'Invoice #1' })).status).toBe(200)
  })

  it('only the creator deletes', async () => {
    const agent = as(app, bearer('creative'))
    const { body } = await agent.post('/api/tasks', { title: 'x' })
    expect((await agent.delete(`/api/tasks/${body.id}`)).status).toBe(403)
    expect((await as(app, basic).delete(`/api/tasks/${body.id}`)).status).toBe(200)
  })

  it('rejects unknown fields instead of storing them', async () => {
    expect((await as(app, basic).post('/api/content', { title: 'x', autoPost: true })).status).toBe(400)
  })
})
