import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, basic, bearer, contentItem, makeApp } from './helpers'

/** Each agent writes only its own collections; everything else is a 403. */
describe('collection ownership', () => {
  let app: INestApplication
  let id: string
  let analysisId: string
  beforeAll(async () => {
    app = await makeApp()
    id = await contentItem(app)
    const snap = await as(app, bearer('analyst')).post('/api/audience/snapshots', { platform: 'x', date: '2026-01-01', source: 'audit', metrics: { followers: 5 } })
    analysisId = (await as(app, bearer('analyst')).post('/api/handoffs', { contentItemId: id, to: 'creative', type: 'analysis', body: 'Data', refs: [{ collection: 'audience_snapshots', id: snap.body.id }] })).body.id
  })
  afterAll(() => app.close())

  const creativeWrites = (cid: string, source: string) => [
    ['/api/briefs', { contentItemId: cid, sourceHandoffId: source, objective: 'x' }],
    ['/api/hooks', { contentItemId: cid, kind: 'curiosity', text: 'x' }],
    ['/api/scripts', { contentItemId: cid, body: 'x' }],
    ['/api/captions', { contentItemId: cid, platform: 'tiktok', text: 'x' }],
  ] as const
  const analystWrites = (cid: string) => [
    ['/api/audience/snapshots', { platform: 'tiktok', date: '2026-01-02', source: 'export', metrics: { followers: 1 } }],
    ['/api/engagement-queue', { comment: 'Nice' }],
    ['/api/experiments', { contentItemId: cid, hypothesis: 'x' }],
  ] as const

  it("the analyst cannot write the creative agent's collections", async () => {
    for (const [path, body] of creativeWrites(id, analysisId)) expect((await as(app, bearer('analyst')).post(path, body)).status, path).toBe(403)
    // Ownership is checked before anything else, even when the body is otherwise invalid.
    for (const [path, body] of creativeWrites('C-404', 'H-404')) expect((await as(app, bearer('analyst')).post(path, body)).status, path).toBe(403)
  })

  it("the creative agent cannot write the analyst's collections", async () => {
    for (const [path, body] of analystWrites(id)) expect((await as(app, bearer('creative')).post(path, body)).status, path).toBe(403)
    for (const [path, body] of analystWrites('C-404')) expect((await as(app, bearer('creative')).post(path, body)).status, path).toBe(403)
  })

  it('neither agent writes the profile, brief, settings, keywords or migrations', async () => {
    for (const role of ['analyst', 'creative'] as const) {
      const a = as(app, bearer(role))
      expect((await a.patch('/api/brief', { fields: [{ key: 'goals', value: 'x' }] })).status).toBe(403)
      expect((await a.put('/api/settings', { campaignStart: '2026-01-01', tiktokGoal: 1, weeklyTikTokTarget: 1, planChecks: {} })).status).toBe(403)
      expect((await a.post('/api/keywords', { keyword: 'X' })).status).toBe(403)
      expect((await a.post('/api/migrations/import', {})).status).toBe(403)
    }
  })

  it('each agent writes its own collections, and both create content items and handoffs', async () => {
    for (const [path, body] of creativeWrites(id, analysisId)) expect((await as(app, bearer('creative')).post(path, body)).status, path).toBe(201)
    for (const [path, body] of analystWrites(id)) expect((await as(app, bearer('analyst')).post(path, body)).status, path).toBe(201)
    for (const role of ['analyst', 'creative'] as const) expect((await as(app, bearer(role)).post('/api/content-items', { title: role })).status).toBe(201)
  })

  it('the creator can write everything', async () => {
    for (const [path, body] of [...creativeWrites(id, analysisId), ...analystWrites(id)]) expect((await as(app, basic).post(path, body)).status, path).toBe(201)
  })

  it('agents send handoffs only as themselves, and only the recipient acknowledges', async () => {
    const analyst = as(app, bearer('analyst'))
    expect((await analyst.post('/api/handoffs', { contentItemId: id, from: 'creative', to: 'creator', type: 'question', body: 'spoof' })).status).toBe(403)
    const h = await analyst.post('/api/handoffs', { contentItemId: id, to: 'creative', type: 'question', body: 'Ready?' })
    expect(h.body.from).toBe('analyst')
    expect((await analyst.post(`/api/handoffs/${h.body.id}/ack`, {})).status).toBe(403)
    expect((await as(app, basic).post(`/api/handoffs/${h.body.id}/ack`, {})).status).toBe(403)
    const ack = await as(app, bearer('creative')).post(`/api/handoffs/${h.body.id}/ack`, {})
    expect(ack.body).toMatchObject({ acknowledgedBy: 'creative' })
    expect(ack.body.acknowledgedAt).toMatch(/^\d{4}-/)
    const open = await analyst.get('/api/handoffs?acknowledged=false')
    expect(open.body.map((x: { id: string }) => x.id)).not.toContain(h.body.id)
  })

  it('the API owns content item ids', async () => {
    const r = await as(app, bearer('creative')).post('/api/content-items', { id: 'MINE-1', title: 'x' })
    expect(r.body.id).toMatch(/^C-\d{3}$/)
  })
})
