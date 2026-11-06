import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'
import { as, basic, bearer, callable, makeApp, routes } from './helpers'

describe('auth', () => {
  let app: INestApplication
  beforeAll(async () => {
    app = await makeApp()
  })
  afterAll(() => app.close())

  it('requires a credential on every route except the data-free health check', async () => {
    const all = routes(app)
    expect(all.length).toBeGreaterThan(30)
    for (const r of all) {
      const url = callable(r.path)
      const res = await request(app.getHttpServer())[r.method.toLowerCase() as 'get'](url).send({})
      if (r.path === '/health') {
        expect(res.status).toBe(200)
        expect(Object.keys(res.body).sort()).toEqual(['draftOnly', 'status'])
      } else {
        expect(res.status, `${r.method} ${r.path}`).toBe(401)
        expect(res.headers['www-authenticate']).toMatch(/^Basic /)
      }
    }
  })

  it('rejects wrong passwords, unknown tokens and malformed headers', async () => {
    const server = request(app.getHttpServer())
    for (const header of [
      `Basic ${Buffer.from('creator-test:wrong').toString('base64')}`,
      'Bearer not-a-real-token-at-all',
      'Bearer ',
      'Token abc',
      'Basic !!!',
    ])
      expect((await server.get('/api/content').set('authorization', header)).status).toBe(401)
  })

  it('accepts the creator login and agent tokens, and reports who is calling', async () => {
    expect((await as(app, basic).get('/api/session')).body.actor).toEqual({ name: 'creator-test', role: 'creator' })
    expect((await as(app, bearer('analyst')).get('/api/session')).body.actor).toEqual({ name: 'analyst-agent', role: 'analyst' })
    expect((await as(app, bearer('worker')).get('/api/session')).body.actor).toEqual({ name: 'scheduler', role: 'worker' })
    expect((await as(app, bearer('creator')).get('/api/session')).body.actor).toEqual({ name: 'creator-script', role: 'creator' })
    expect((await as(app, bearer('creative')).get('/api/session')).body.actor).toEqual({ name: 'creative-agent', role: 'creative' })
  })

  it('records who wrote each item, when, and from where', async () => {
    const res = await as(app, bearer('creative')).post('/api/content', { title: 'Draft' }).set('x-growth-source', 'agent session')
    expect(res.status).toBe(201)
    expect(res.body._meta).toMatchObject({ createdBy: 'creative-agent', createdRole: 'creative', createdSource: 'agent session' })
    expect(res.body._meta.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const dash = await as(app, basic).patch(`/api/content/${res.body.id}`, { caption: 'x' }).set('x-growth-client', 'dashboard')
    expect(dash.body._meta).toMatchObject({ createdBy: 'creative-agent', updatedBy: 'dashboard', updatedRole: 'creator' })
    const log = await as(app, basic).get('/api/state')
    expect(log.status).toBe(200)
  })

  it('the scheduler key can only dispatch events', async () => {
    const worker = as(app, bearer('worker'))
    for (const path of ['/api/content', '/api/handoffs', '/api/state', '/api/profile']) expect((await worker.get(path)).status, path).toBe(403)
    expect((await worker.post('/api/handoffs', { contentItemId: 'AUDIT-2026-01-01', to: 'analyst', type: 'question', body: 'x' })).status).toBe(403)
    expect((await worker.post('/api/dispatch/daily-audit', {})).status).toBe(201)
  })

  it('fails closed without a creator login and rejects weak or shared keys', () => {
    const base = { GROWTH_OS_USER: 'me', GROWTH_OS_PASS: 'a-long-enough-password' }
    expect(() => loadConfig({})).toThrow(/GROWTH_OS_USER/)
    expect(() => loadConfig({ GROWTH_OS_USER: 'a', GROWTH_OS_PASS: 'short' })).toThrow()
    expect(() => loadConfig({ ...base, GROWTH_OS_ANALYST_KEY: 'short' })).toThrow(/too short/)
    expect(() => loadConfig({ ...base, GROWTH_OS_ANALYST_KEY: 'same-key-same-key-1', GROWTH_OS_CREATIVE_KEY: 'same-key-same-key-1' })).toThrow(/different/)
    expect(() => loadConfig({ ...base, ANALYST_WEBHOOK_URL: 'ftp://x' })).toThrow(/http/)
    const c = loadConfig({ ...base, GROWTH_OS_ANALYST_KEY: 'analyst-key-0000000001', GROWTH_OS_ANALYST_NAME: 'scout', ANALYST_WEBHOOK_URL: 'https://hooks.example/a', ANALYST_WEBHOOK_KEY: 'k' })
    expect(c.keys).toEqual([{ name: 'scout', role: 'analyst', token: 'analyst-key-0000000001' }])
    expect(c.webhooks).toEqual({ analyst: { url: 'https://hooks.example/a', key: 'k' } })
    expect(() => loadConfig({ ...base, GROWTH_OS_CONNECTOR_KEY: 'too-short-for-a-url-key' })).toThrow(/32/)
    expect(loadConfig({ ...base, GROWTH_OS_CONNECTOR_KEY: 'c'.repeat(64) }).keys).toEqual([{ name: 'analyst-connector', role: 'analyst', token: 'c'.repeat(64), scope: 'mcp' }])
  })
})
