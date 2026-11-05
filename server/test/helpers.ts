import type { INestApplication } from '@nestjs/common'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import request from 'supertest'
import { createApp } from '../src/bootstrap'
import type { AppConfig } from '../src/config'
import { MemoryStore } from '../src/db/memory.store'

export const CREATOR = { user: 'creator-test', pass: 'creator-test-password-0001' }
export const TOKENS = { analyst: 'analyst-test-token-000000001', creative: 'creative-test-token-00000001', worker: 'worker-test-token-0000000001', creator: 'creator-test-token-000000001', connector: 'connector-test-key-0123456789abcdef0123' }

export const testConfig: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  mongoUrl: undefined,
  mongoDb: 'test',
  creatorUser: CREATOR.user,
  creatorPass: CREATOR.pass,
  keys: [
    { name: 'analyst-agent', role: 'analyst', token: TOKENS.analyst },
    { name: 'creative-agent', role: 'creative', token: TOKENS.creative },
    { name: 'scheduler', role: 'worker', token: TOKENS.worker },
    { name: 'creator-script', role: 'creator', token: TOKENS.creator },
    { name: 'analyst-connector', role: 'analyst', token: TOKENS.connector, scope: 'mcp' },
  ],
  webhooks: {},
  webhookRetryBaseMs: 1,
}

export async function makeApp(overrides: Partial<AppConfig> = {}): Promise<INestApplication> {
  const app = await createApp({ ...testConfig, ...overrides }, new MemoryStore(), false)
  await app.init()
  return app
}

/** A content item to hang handoffs off. */
export async function contentItem(app: INestApplication, title = 'Test item'): Promise<string> {
  const r = await as(app, basic).post('/api/content-items', { title })
  if (r.status !== 201) throw new Error(`content item: ${r.status} ${JSON.stringify(r.body)}`)
  return r.body.id
}

export const basic = `Basic ${Buffer.from(`${CREATOR.user}:${CREATOR.pass}`).toString('base64')}`
export const bearer = (role: keyof typeof TOKENS) => `Bearer ${TOKENS[role]}`

export const as = (app: INestApplication, auth: string) => {
  const agent = request(app.getHttpServer())
  return {
    get: (url: string) => agent.get(url).set('authorization', auth),
    post: (url: string, body: object) => agent.post(url).set('authorization', auth).send(body),
    patch: (url: string, body: object) => agent.patch(url).set('authorization', auth).send(body),
    put: (url: string, body: object) => agent.put(url).set('authorization', auth).send(body),
    delete: (url: string) => agent.delete(url).set('authorization', auth),
  }
}

export interface RouteInfo {
  method: string
  path: string
}

/** Every route registered on the Express adapter underneath Nest. */
export function routes(app: INestApplication): RouteInfo[] {
  const express = app.getHttpAdapter().getInstance() as { router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] } }
  return express.router.stack
    .filter((l) => l.route)
    .flatMap((l) => Object.keys(l.route!.methods).map((m) => ({ method: m.toUpperCase(), path: l.route!.path })))
}

/** Replace :params with a sample value so the route can be called. */
export const callable = (path: string) => path.replace(/:[a-zA-Z]+/g, 'C-001')

export const repoRoot = `${join(__dirname, '..', '..')}/`

/** The private workspace, when this checkout has one. Tests that use it skip themselves on a fresh clone. */
export function privateWorkspace(): { profile?: { [k: string]: unknown } } | null {
  const f = `${repoRoot}private/workspace.json`
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
}

/** Identifiers from a profile that must never leak (brand, company, project, agent names, handles). */
export function identifiers(profile: Record<string, unknown> | undefined): string[] {
  if (!profile) return []
  const p = profile as { brandName?: string; company?: string; projectName?: string; agents?: { analyst?: { name?: string }; creative?: { name?: string } }; handles?: Record<string, string> }
  return [p.brandName, p.company, p.projectName, p.agents?.analyst?.name, p.agents?.creative?.name, ...Object.values(p.handles ?? {}).map((h) => h?.replace(/^@/, ''))]
    .map((t) => t?.trim())
    .filter((t): t is string => !!t && t.length >= 4)
}
