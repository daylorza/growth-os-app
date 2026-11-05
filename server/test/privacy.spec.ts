import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, basic, callable, identifiers, makeApp, privateWorkspace, routes } from './helpers'

/** Fictional stand-in used when this checkout has no private workspace. */
const SAMPLE = {
  creatorName: 'Nova',
  brandName: 'NOVA_BUILDS',
  company: 'Lumen Labs',
  projectName: 'Atlas',
  handles: { tiktok: '@nova.sample', x: '@nova_sample' },
  agents: { analyst: { name: 'Scout', role: 'Analyst' }, creative: { name: 'Quill', role: 'Creative' } },
  sample: true,
}

describe('privacy: unauthenticated callers learn nothing', () => {
  let app: INestApplication
  const profile = (privateWorkspace()?.profile as typeof SAMPLE | undefined) ?? SAMPLE
  const terms = identifiers(profile).map((t) => t.toLowerCase())

  beforeAll(async () => {
    app = await makeApp()
    await as(app, basic).put('/api/profile', { ...profile, masterPrompt: 'secret prompt text' })
    await as(app, basic).post('/api/handoffs', { contentItemId: 'AUDIT-2026-01-01', to: 'creative', type: 'question', body: `Report for ${Object.values(profile.handles).join(' ')}` })
  })
  afterAll(() => app.close())

  it('the profile is stored and readable with a credential', async () => {
    const p = await as(app, basic).get('/api/profile')
    expect(p.body.brandName).toBe(profile.brandName)
  })

  it('no route leaks profile identifiers, handles or the master prompt without a credential', async () => {
    expect(terms.length).toBeGreaterThan(0)
    for (const r of routes(app)) {
      for (const auth of [undefined, 'Basic d3Jvbmc6d3Jvbmc=', 'Bearer wrong-token-wrong-token']) {
        let req = request(app.getHttpServer())[r.method.toLowerCase() as 'get'](callable(r.path))
        if (auth) req = req.set('authorization', auth)
        const res = await req.send({})
        const text = (JSON.stringify(res.body) + JSON.stringify(res.headers)).toLowerCase()
        for (const t of [...terms, 'secret prompt text']) expect(text, `${r.method} ${r.path}`).not.toContain(t)
      }
    }
  })
})
