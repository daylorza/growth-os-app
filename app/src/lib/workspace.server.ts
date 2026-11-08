import 'server-only'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { headers } from 'next/headers'
import { today } from './dates'
import type { PrivateData } from './private'
import type { EndpointState } from './remote'

/** Where the server finds its data. */
export type Initial = (
  | { mode: 'local'; private: PrivateData }
  | { mode: 'endpoint'; state: EndpointState }
  | { mode: 'offline'; error: string }
) & { today: string }

/** Base URL of the NestJS API, server-side only. Unset means local mode (no endpoint, data in this browser). */
export const apiBase = () => process.env.GROWTH_OS_API?.trim().replace(/\/$/, '') || ''

const privateDir = () => process.env.GROWTH_OS_PRIVATE_DIR?.trim() || join(process.cwd(), '..', 'private')

const readJson = (f: string) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined)

/** Local mode: the gitignored private folder, read per request so it is never baked into a build. */
export function readPrivate(): PrivateData {
  if (process.env.GROWTH_OS_IGNORE_PRIVATE === '1') return {}
  const dir = privateDir()
  const prompt = join(dir, 'brand', 'MASTER_AGENT_PROMPT.md')
  return {
    workspace: readJson(join(dir, 'workspace.json')),
    tiktok: readJson(join(dir, 'vault', 'tiktok', 'tiktok-snapshot.json')),
    masterPrompt: existsSync(prompt) ? readFileSync(prompt, 'utf8') : undefined,
  }
}

/** Server-side call to the API with the caller's own credential. The Next server holds no secrets. */
export async function apiGet<T>(path: string): Promise<T> {
  const auth = (await headers()).get('authorization')
  const res = await fetch(`${apiBase()}${path}`, { headers: { ...(auth ? { authorization: auth } : {}), 'x-growth-client': 'dashboard' }, cache: 'no-store' })
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return (await res.json()) as T
}

export async function loadInitial(): Promise<Initial> {
  const day = today()
  if (!apiBase()) return { mode: 'local', private: readPrivate(), today: day }
  try {
    return { mode: 'endpoint', state: await apiGet<EndpointState>('/api/state'), today: day }
  } catch (e) {
    return { mode: 'offline', error: e instanceof Error ? e.message : String(e), today: day }
  }
}
