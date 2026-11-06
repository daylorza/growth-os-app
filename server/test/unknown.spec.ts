import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, basic, bearer, makeApp } from './helpers'

describe('UNKNOWN stays UNKNOWN', () => {
  let app: INestApplication
  beforeAll(async () => {
    app = await makeApp()
  })
  afterAll(() => app.close())

  it('an empty brief is UNKNOWN and unverified, never blank', async () => {
    const b = (await as(app, basic).get('/api/brief')).body
    expect(Object.keys(b).length).toBe(18)
    for (const f of Object.values(b) as { value: string; verified: boolean }[]) expect(f).toEqual({ value: 'UNKNOWN', verified: false })
  })

  it('blank brief values become UNKNOWN and UNKNOWN is never verified', async () => {
    const day = as(app, basic)
    const r = await day.patch('/api/brief', { fields: [{ key: 'timezone', value: '   ', verified: true }] })
    expect(r.body.timezone).toMatchObject({ value: 'UNKNOWN', verified: false })
    const ok = await day.patch('/api/brief', { fields: [{ key: 'timezone', value: 'UTC+1', verified: true, source: 'creator' }] })
    expect(ok.body.timezone).toEqual({ value: 'UTC+1', verified: true, source: 'creator' })
  })

  it('agents cannot verify brief fields', async () => {
    expect((await as(app, bearer('creative')).patch('/api/brief', { fields: [{ key: 'goals', value: 'Grow', verified: true }] })).status).toBe(403)
  })

  it('missing or null snapshot metrics are stored as UNKNOWN, not 0', async () => {
    const day = as(app, basic)
    const r = await day.post('/api/audience/snapshots', { platform: 'x', date: '2026-02-01', source: 'manual', metrics: { followers: 10, posts: null, views7d: 'UNKNOWN' } })
    expect(r.body.metrics).toEqual({ followers: 10, following: 'UNKNOWN', posts: 'UNKNOWN', views7d: 'UNKNOWN', views14d: 'UNKNOWN', views28d: 'UNKNOWN', engagementRate: 'UNKNOWN' })
    expect((await day.post('/api/audience/snapshots', { platform: 'x', date: '2026-02-01', source: 'manual', metrics: { followers: 'about 10' } })).status).toBe(400)
    expect((await day.post('/api/audience/snapshots', { platform: 'x', date: '2026-02-01', source: 'manual', metrics: { followers: -1 } })).status).toBe(400)
  })

  it('analytics report UNKNOWN when there is no observation, and no growth from a single point', async () => {
    const s = (await as(app, basic).get('/api/analytics/summary?platform=x')).body.metrics
    expect(s.followers).toMatchObject({ start: 10, end: 10, net: 'UNKNOWN', growthPct: 'UNKNOWN' })
    expect(s.views28d).toMatchObject({ start: 'UNKNOWN', end: 'UNKNOWN' })
    expect((await as(app, basic).get('/api/analytics/summary?platform=tiktok')).body.metrics.followers.end).toBe('UNKNOWN')
  })
})
