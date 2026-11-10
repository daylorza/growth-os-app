import type { INestApplication } from '@nestjs/common'
import type { PublishTarget } from '@growth-os/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, basic, bearer, contentItem, makeApp } from './helpers'

const inHour = () => new Date(Date.now() + 3_600_000).toISOString()
const target = (platform: PublishTarget['platform'], over: Partial<PublishTarget> = {}) => ({ platform, caption: `${platform} caption`, scheduledAt: inHour(), ...over })

describe('platform versions published through Buffer', () => {
  let app: INestApplication
  beforeAll(async () => {
    app = await makeApp()
  })
  afterAll(() => app.close())

  const day = () => as(app, basic)
  const setTargets = (who: ReturnType<typeof as>, id: string, targets: object[], extra: object = {}) => who.patch(`/api/content/${id}`, { targets, ...extra })
  /** An approved item with a media link and one draft version per platform given. */
  async function approvedItem(...platforms: PublishTarget['platform'][]) {
    const id = await contentItem(app)
    expect((await day().patch(`/api/content/${id}`, { approval: 'approved', status: 'approved', mediaUrl: 'https://media.example.com/clip.mp4', targets: platforms.map((p) => target(p)) })).status).toBe(200)
    return id
  }
  const targets = async (id: string) => (await day().get(`/api/content/${id}`)).body.targets as PublishTarget[]
  const approve = async (id: string, p: PublishTarget['platform']) => setTargets(day(), id, (await targets(id)).map((t) => (t.platform === p ? { ...t, status: 'approved' } : t)))

  it('agents draft captions but never approve, schedule or touch the publishing state', async () => {
    const id = await contentItem(app)
    const creative = as(app, bearer('creative'))
    const r = await setTargets(creative, id, [target('threads')])
    expect(r.status).toBe(200)
    expect(r.body.targets[0]).toMatchObject({ platform: 'threads', status: 'draft', bufferPostId: '', liveUrl: '', error: '' })
    await day().patch(`/api/content/${id}`, { approval: 'approved', status: 'approved' })
    expect((await setTargets(creative, id, [{ ...r.body.targets[0], status: 'approved' }])).status).toBe(403)
    expect((await setTargets(creative, id, [{ ...r.body.targets[0], bufferPostId: 'b1' }])).status).toBe(403)
    expect((await setTargets(as(app, bearer('analyst')), id, [{ ...r.body.targets[0], status: 'approved' }])).status).toBe(403)
  })

  it('a version is approved only by the creator, on an approved item, with a caption, a future time and (TikTok) a video', async () => {
    const id = await contentItem(app)
    await setTargets(day(), id, [target('tiktok'), target('x', { caption: ' ' })])
    expect((await approve(id, 'tiktok')).body.message).toMatch(/Approve the content item/)
    await day().patch(`/api/content/${id}`, { approval: 'approved', status: 'approved' })
    expect((await approve(id, 'tiktok')).body.message).toMatch(/needs a video/)
    expect((await approve(id, 'x')).body.message).toMatch(/Write the X caption/)
    await setTargets(day(), id, [target('tiktok', { scheduledAt: new Date(Date.now() + 60_000).toISOString() })], { mediaUrl: 'https://media.example.com/clip.mp4' })
    expect((await approve(id, 'tiktok')).body.message).toMatch(/at least 10 minutes/)
    await setTargets(day(), id, [target('tiktok')])
    const ok = await approve(id, 'tiktok')
    expect(ok.status).toBe(200)
    expect(ok.body.targets[0].status).toBe('approved')
  })

  it('an approved version is locked: no caption, time or media change until it is unapproved', async () => {
    const id = await approvedItem('threads')
    await approve(id, 'threads')
    const [t] = await targets(id)
    expect((await setTargets(day(), id, [{ ...t, caption: 'changed' }])).body.message).toMatch(/Unapprove or cancel/)
    expect((await day().patch(`/api/content/${id}`, { mediaUrl: 'https://media.example.com/other.mp4' })).status).toBe(400)
    const back = await setTargets(day(), id, [{ ...t, status: 'draft', caption: 'changed' }])
    expect(back.status).toBe(200)
    expect(back.body.targets[0]).toMatchObject({ status: 'draft', caption: 'changed' })
  })

  it('only the connector path marks a version scheduled (with a Buffer id), and the item follows', async () => {
    const id = await approvedItem('threads', 'x')
    await approve(id, 'threads')
    const [t, x] = await targets(id)
    expect((await setTargets(day(), id, [{ ...t, status: 'scheduled' }, x])).body.message).toMatch(/Buffer connector/)
    const r = await setTargets(day(), id, [{ ...t, status: 'scheduled', bufferPostId: 'buf-1' }, x])
    expect(r.status).toBe(200)
    expect(r.body.status).toBe('scheduled')
    expect((await setTargets(day(), id, [x])).body.message).toMatch(/still in Buffer/)
    expect((await day().patch(`/api/content/${id}`, { status: 'killed' })).body.message).toMatch(/Cancel the approved or scheduled/)
    expect((await day().delete(`/api/content/${id}`)).body.message).toMatch(/nothing is left in Buffer/)
  })

  it('a cancelled version goes back to draft only once Buffer no longer holds it', async () => {
    const id = await approvedItem('threads')
    await approve(id, 'threads')
    const [t] = await targets(id)
    await setTargets(day(), id, [{ ...t, status: 'scheduled', bufferPostId: 'buf-2' }])
    expect((await setTargets(day(), id, [{ ...t, status: 'cancelled', bufferPostId: 'buf-2' }])).status).toBe(200)
    expect((await setTargets(day(), id, [{ ...t, status: 'draft', bufferPostId: 'buf-2' }])).body.message).toMatch(/still in Buffer/)
    await setTargets(day(), id, [{ ...t, status: 'cancelled', bufferPostId: '' }])
    expect((await setTargets(day(), id, [{ ...t, status: 'draft', bufferPostId: '' }])).status).toBe(200)
  })

  it('the item is published once every version is live; a failed one keeps it open; a live one never changes', async () => {
    const id = await approvedItem('threads', 'x')
    await approve(id, 'threads')
    await approve(id, 'x')
    const [t, x] = await targets(id)
    await setTargets(day(), id, [{ ...t, status: 'scheduled', bufferPostId: 'b-t' }, { ...x, status: 'scheduled', bufferPostId: 'b-x' }])
    const half = await setTargets(day(), id, [{ ...t, status: 'sent', bufferPostId: 'b-t', liveUrl: 'https://www.threads.com/@me/post/1' }, { ...x, status: 'failed', bufferPostId: 'b-x', error: 'Channel disconnected' }])
    expect(half.status).toBe(200)
    expect(half.body.status).toBe('scheduled')
    const [sent, failed] = half.body.targets as PublishTarget[]
    expect((await setTargets(day(), id, [{ ...sent, caption: 'edit' }, failed])).body.message).toMatch(/is live/)
    expect((await setTargets(day(), id, [failed])).body.message).toMatch(/is live/)
    await setTargets(day(), id, [sent, { ...failed, status: 'cancelled' }])
    const done = await setTargets(day(), id, [sent, { ...failed, status: 'cancelled', bufferPostId: '' }])
    expect(done.body).toMatchObject({ status: 'published', url: 'https://www.threads.com/@me/post/1' })
    expect(done.body.publishedAt).toMatch(/^\d{4}-/)
    const thread = (await day().get(`/api/content-items/${id}/handoffs`)).body as { to: string; body: string }[]
    expect(thread.some((h) => h.to === 'analyst' && h.body.includes('Published through Buffer'))).toBe(true)
  })

  it('Buffer metrics on a live version: written only with the creator key, kept when a save leaves them out, never on a new version', async () => {
    const id = await approvedItem('threads', 'x')
    await approve(id, 'threads')
    const [t, x] = await targets(id)
    await setTargets(day(), id, [{ ...t, status: 'scheduled', bufferPostId: 'b-t' }, x])
    const live = { ...t, status: 'sent', bufferPostId: 'b-t', liveUrl: 'https://www.threads.com/@me/post/2' }
    await setTargets(day(), id, [live, x])
    const metrics = { source: 'buffer', measuredAt: '2026-11-10T03:00:00.000Z', readAt: '2026-11-10T12:00:00.000Z', values: [{ type: 'views', name: 'Views', value: 12, unit: 'count' }] }
    expect((await setTargets(day(), id, [{ ...live, metrics }, x])).status).toBe(200)
    const creative = as(app, bearer('creative'))
    const forged = { ...metrics, values: [{ type: 'views', name: 'Views', value: 9000, unit: 'count' }] }
    expect((await setTargets(creative, id, [{ ...live, metrics: forged }, x])).status).toBe(403)
    expect((await setTargets(creative, id, [{ ...live, metrics: { values: metrics.values, readAt: metrics.readAt, measuredAt: metrics.measuredAt, source: 'buffer' } }, { ...x, caption: 'new X caption' }])).status).toBe(200)
    expect((await setTargets(creative, id, [live, { ...x, caption: 'another X caption' }])).status).toBe(200)
    expect((await targets(id))[0].metrics).toEqual(metrics)
    expect((await setTargets(day(), id, [{ ...live, metrics }, x, target('tiktok', { metrics })])).body.message).toMatch(/starts as a draft/)
    expect((await setTargets(day(), id, [{ ...live, metrics: { ...metrics, values: [{ type: 'views', name: 'Views', value: -1, unit: 'count' }] } }, x])).status).toBe(400)
  })

  it('a new version starts as a draft, and there is one per platform', async () => {
    const id = await approvedItem()
    expect((await setTargets(day(), id, [target('x', { status: 'approved' })])).body.message).toMatch(/starts as a draft/)
    expect((await setTargets(day(), id, [target('x'), target('x')])).body.message).toMatch(/One version per platform/)
    expect((await day().patch(`/api/content/${id}`, { mediaUrl: 'http://insecure.example.com/a.mp4' })).status).toBe(400)
  })
})
