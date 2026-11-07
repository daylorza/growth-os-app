import type { Handoff as ApiHandoff } from '@growth-os/contracts'
import { describe, expect, it } from 'vitest'
import { diff, fromEndpoint, toDashboardHandoff, toFollowerSnapshot, type EndpointState, type ServerSnapshot } from './remote'
import { createSampleSeed } from './seed'

const snap = (over: Partial<ServerSnapshot> = {}): ServerSnapshot => ({
  id: 'S-001',
  platform: 'x',
  date: '2026-01-01',
  source: 'manual',
  sourceType: 'manual',
  metrics: { followers: 10, following: 'UNKNOWN', posts: 'UNKNOWN', views7d: 'UNKNOWN', views14d: 'UNKNOWN', views28d: 'UNKNOWN', engagementRate: 'UNKNOWN' },
  verified: false,
  ...over,
})

describe('endpoint sync', () => {
  it('sends only what changed, as REST calls', () => {
    const a = createSampleSeed('2026-01-01')
    const c = a.content[0]
    const b = {
      ...a,
      content: [{ ...c, caption: 'New caption' }, ...a.content.slice(1)],
      handoffs: [...a.handoffs, { id: 'H-900', from: 'creator' as const, to: 'creative' as const, itemId: c.id, message: 'Go', createdAt: 'now', acknowledged: false }],
      tasks: a.tasks.slice(1),
    }
    expect(diff(a, b)).toEqual([
      { method: 'PATCH', path: `/api/content/${c.id}`, body: { caption: 'New caption' } },
      { method: 'DELETE', path: `/api/tasks/${a.tasks[0].id}` },
      { method: 'POST', path: '/api/handoffs', body: { id: 'H-900', contentItemId: c.id, from: 'creator', to: 'creative', type: 'question', body: 'Go', refs: [], createdAt: 'now' } },
    ])
    expect(diff(a, a)).toEqual([])
  })

  it('maps follower snapshots without inventing counts', () => {
    expect(toFollowerSnapshot(snap())).toMatchObject({ count: 10, platform: 'x' })
    expect(toFollowerSnapshot(snap({ metrics: { ...snap().metrics, followers: 'UNKNOWN' } }))).toBeNull()
    const a = createSampleSeed('2026-01-01')
    const added = { ...a, snapshots: [...a.snapshots, { id: 'S-999', platform: 'tiktok' as const, date: '2026-01-02', count: 5, source: '', verified: false }] }
    expect(diff(a, added)).toEqual([{ method: 'POST', path: '/api/audience/snapshots', body: { id: 'S-999', platform: 'tiktok', date: '2026-01-02', source: 'Manual', sourceType: 'manual', metrics: { followers: 5 }, verified: false } }])
  })

  it('keeps the master prompt out of the profile and endpoint metadata out of writes', () => {
    const base = createSampleSeed('2026-01-01')
    const s = { ...base, profile: { ...base.profile, masterPrompt: 'secret' }, snapshots: [snap()], tiktokVault: null, initialized: true, settings: null } as unknown as EndpointState
    const { state, private: priv } = fromEndpoint(s, base)
    expect(state.profile).not.toHaveProperty('masterPrompt')
    expect(priv.masterPrompt).toBe('secret')
    const withMeta = { ...state, handoffs: state.handoffs.map((h) => ({ ...h, _meta: { createdBy: 'x', createdAt: '', updatedBy: 'x', updatedAt: '' } })) }
    expect(diff(withMeta, { ...withMeta, handoffs: withMeta.handoffs.map((h) => ({ ...h, _meta: { ...h._meta, updatedAt: 'later' } })) })).toEqual([])
  })
})

describe('handoffs over the endpoint', () => {
  it('maps the API handoff to the log entry and acknowledges with POST /ack', () => {
    const api: ApiHandoff = { id: 'H-1', contentItemId: 'C-001', from: 'analyst', to: 'creator', type: 'analysis', body: 'Data', refs: [], createdAt: '2026-01-01T00:00:00Z' }
    const h = toDashboardHandoff(api)
    expect(h).toMatchObject({ itemId: 'C-001', message: 'Data', acknowledged: false, type: 'analysis' })
    expect(toDashboardHandoff({ ...api, acknowledgedAt: '2026-01-02T00:00:00Z', acknowledgedBy: 'creator' }).acknowledged).toBe(true)
    // Refs survive a reload, so the dashboard still knows which item a send request was for.
    expect(toDashboardHandoff({ ...api, refs: [{ collection: 'engagement_queue', id: 'E-1' }] }).refs).toEqual([{ collection: 'engagement_queue', id: 'E-1' }])
    const a = { ...createSampleSeed('2026-01-01'), handoffs: [h] }
    expect(diff(a, { ...a, handoffs: [{ ...h, acknowledged: true }] })).toEqual([{ method: 'POST', path: '/api/handoffs/H-1/ack' }])
    expect(diff(a, { ...a, handoffs: [{ ...h, message: 'edited' }] })).toEqual([])
    expect(diff(a, { ...a, handoffs: [] })).toEqual([])
  })
})
