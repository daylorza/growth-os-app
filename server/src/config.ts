import type { Owner, Role } from '@growth-os/contracts'

export interface ApiKey {
  /** Recorded as the author of every write made with this key. */
  name: string
  role: Exclude<Role, 'creator'> | 'creator'
  token: string
}

export interface Webhook {
  url: string
  key: string
}

export interface AppConfig {
  host: string
  port: number
  mongoUrl: string | undefined
  mongoDb: string
  creatorUser: string
  creatorPass: string
  keys: ApiKey[]
  /** Where each role is woken up. A role without a webhook reads the API instead. */
  webhooks: Partial<Record<Owner, Webhook>>
  webhookRetryBaseMs: number
}

export const CONFIG = Symbol('CONFIG')

const MIN_SECRET = 16

const key = (env: NodeJS.ProcessEnv, role: ApiKey['role'], fallbackName: string): ApiKey[] => {
  const prefix = `GROWTH_OS_${role.toUpperCase()}`
  const token = env[`${prefix}_KEY`]?.trim()
  if (!token) return []
  if (token.length < MIN_SECRET) throw new Error(`${prefix}_KEY is too short (min ${MIN_SECRET} characters).`)
  return [{ name: env[`${prefix}_NAME`]?.trim() || fallbackName, role, token }]
}

const webhook = (env: NodeJS.ProcessEnv, role: Owner): Webhook[] => {
  const url = env[`${role.toUpperCase()}_WEBHOOK_URL`]?.trim()
  if (!url) return []
  if (!/^https?:\/\//.test(url)) throw new Error(`${role.toUpperCase()}_WEBHOOK_URL must be an http(s) URL.`)
  return [{ url, key: env[`${role.toUpperCase()}_WEBHOOK_KEY`]?.trim() ?? '' }]
}

/**
 * Fails closed: the server refuses to start without a creator login.
 * Keys: GROWTH_OS_ANALYST_KEY, GROWTH_OS_CREATIVE_KEY, GROWTH_OS_CREATOR_KEY (scripts), GROWTH_OS_WORKER_KEY (scheduler).
 * Names for attribution: GROWTH_OS_<ROLE>_NAME. Webhooks: ANALYST_WEBHOOK_URL / ANALYST_WEBHOOK_KEY (and CREATIVE_…).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const creatorUser = env.GROWTH_OS_USER?.trim() ?? ''
  const creatorPass = env.GROWTH_OS_PASS ?? ''
  if (!creatorUser || creatorPass.length < MIN_SECRET) throw new Error(`GROWTH_OS_USER and GROWTH_OS_PASS (min ${MIN_SECRET} characters) are required.`)
  const keys = [...key(env, 'analyst', 'analyst'), ...key(env, 'creative', 'creative'), ...key(env, 'creator', creatorUser), ...key(env, 'worker', 'scheduler')]
  if (new Set(keys.map((k) => k.token)).size !== keys.length) throw new Error('Every key must be different.')
  return {
    host: env.GROWTH_OS_HOST?.trim() || '127.0.0.1',
    port: Number(env.GROWTH_OS_PORT ?? 8767),
    mongoUrl: env.GROWTH_OS_MONGO_URL?.trim() || undefined,
    mongoDb: env.GROWTH_OS_MONGO_DB?.trim() || 'growth_os',
    creatorUser,
    creatorPass,
    keys,
    webhooks: Object.fromEntries((['analyst', 'creative'] as const).flatMap((r) => webhook(env, r).map((w) => [r, w]))),
    webhookRetryBaseMs: Number(env.WEBHOOK_RETRY_BASE_MS ?? 1000),
  }
}
