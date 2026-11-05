import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, basic, bearer, makeApp, routes } from './helpers'

const TIKTOK = { platform: 'tiktok', date: '2026-01-10', source: 'Platform export', sourceType: 'platform_export', metrics: { followers: 1234, views28d: 5000, engagementRate: 4.2 } }
const X = { platform: 'x', date: '2026-01-11', source: 'Analyst audit', sourceType: 'analyst_agent', metrics: { followers: 4321, following: 100, posts: 900 } }

describe('audience snapshots: platforms are never summed', () => {
  let app: INestApplication
  beforeAll(async () => {
    app = await makeApp()
    await as(app, basic).post('/api/audience/snapshots', TIKTOK)
    await as(app, bearer('analyst')).post('/api/audience/snapshots', X)
  })
  afterAll(() => app.close())

  it('returns the latest snapshot for exactly one platform', async () => {
    const day = as(app, basic)
    expect((await day.get('/api/audience/latest?platform=tiktok')).body.metrics.followers).toBe(1234)
    expect((await day.get('/api/audience/latest?platform=x')).body.metrics.followers).toBe(4321)
  })

  it('refuses a combined or missing platform', async () => {
    const day = as(app, basic)
    for (const q of ['', '?platform=all', '?platform=tiktok,x', '?platform=total']) expect((await day.get(`/api/audience/latest${q}`)).status).toBe(400)
    expect((await day.get('/api/analytics/summary')).status).toBe(400)
    expect((await day.get('/api/analytics/series?platform=all&metric=followers')).status).toBe(400)
  })

  it('no GET response anywhere contains a cross-platform total', async () => {
    const day = as(app, basic)
    const sums = [1234 + 4321, 5000 + 0].map(String)
    const gets = routes(app).filter((r) => r.method === 'GET' && !r.path.includes(':'))
    const queries: Record<string, string[]> = {
      '/api/audience/latest': ['?platform=tiktok', '?platform=x'],
      '/api/analytics/series': ['?platform=tiktok&metric=followers', '?platform=x&metric=followers'],
      '/api/analytics/summary': ['?platform=tiktok', '?platform=x'],
    }
    for (const r of gets)
      for (const q of queries[r.path] ?? ['']) {
        const text = JSON.stringify((await day.get(r.path + q)).body)
        expect(text, r.path + q).not.toContain(`:${sums[0]}`)
      }
  })

  it('agent-reported snapshots are unverified until the creator verifies them', async () => {
    expect((await as(app, bearer('analyst')).post('/api/audience/snapshots', { ...X, verified: true })).status).toBe(403)
    expect((await as(app, basic).get('/api/audience/latest?platform=x')).body.verified).toBe(false)
  })

  it('analytics facts are append-only: a deleted snapshot is retracted, not erased', async () => {
    const day = as(app, basic)
    const s = await day.post('/api/audience/snapshots', { ...TIKTOK, date: '2026-01-12', metrics: { followers: 1300 } })
    expect((await day.get('/api/analytics/series?platform=tiktok&metric=followers')).body.points.map((p: { value: number }) => p.value)).toEqual([1234, 1300])
    await day.delete(`/api/audience/snapshots/${s.body.id}`)
    const after = await day.get('/api/analytics/series?platform=tiktok&metric=followers')
    expect(after.body.points.map((p: { value: number }) => p.value)).toEqual([1234])
    expect(after.body.sql).toContain("platform = 'tiktok'")
  })

  it('summarises growth per platform only', async () => {
    const day = as(app, basic)
    await day.post('/api/audience/snapshots', { ...TIKTOK, date: '2026-01-20', metrics: { followers: 1300 } })
    const s = await day.get('/api/analytics/summary?platform=tiktok')
    expect(s.body.metrics.followers).toMatchObject({ start: 1234, end: 1300, net: 66, growthPct: 5.3 })
    expect(s.body.platform).toBe('tiktok')
  })

  it('publishes a governed catalog for the fact table', async () => {
    const c = await as(app, basic).get('/api/analytics/catalog')
    expect(c.body.tables[0]).toMatchObject({ name: 'growth_os.audience.snapshot_facts', tags: { write_mode: 'append_only', platform_scoped: 'true' } })
  })
})
