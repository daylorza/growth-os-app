import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { NextRequest, NextResponse } from 'next/server'

/**
 * The dashboard login lives in an encrypted, HttpOnly cookie instead of the browser's Basic-auth prompt.
 * The cookie holds the creator's own credential, sealed with AES-256-GCM, so the API still checks every call
 * and the Next server keeps no password at rest. The key comes from GROWTH_OS_SESSION_SECRET or a
 * 0600 key file created on first use (GROWTH_OS_SESSION_KEY_FILE, default ~/.config/growth-os/session.key).
 */
export const SESSION_COOKIE = 'growth_os_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30

let cached: Buffer | undefined

function key(): Buffer {
  if (cached) return cached
  const secret = process.env.GROWTH_OS_SESSION_SECRET?.trim()
  if (secret) return (cached = createHash('sha256').update(secret).digest())
  const file = process.env.GROWTH_OS_SESSION_KEY_FILE?.trim() || join(homedir(), '.config', 'growth-os', 'session.key')
  try {
    if (existsSync(/*turbopackIgnore: true*/ file)) return (cached = Buffer.from(readFileSync(/*turbopackIgnore: true*/ file, 'utf8').trim(), 'base64url'))
    mkdirSync(/*turbopackIgnore: true*/ dirname(file), { recursive: true, mode: 0o700 })
    const k = randomBytes(32)
    writeFileSync(/*turbopackIgnore: true*/ file, k.toString('base64url'), { mode: 0o600, flag: 'wx' })
    chmodSync(/*turbopackIgnore: true*/ file, 0o600)
    return (cached = k)
  } catch {
    // Read-only home: sessions last until the next restart.
    return (cached = randomBytes(32))
  }
}

export function seal(authorization: string, now = Date.now()): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([cipher.update(JSON.stringify({ a: authorization, exp: now + SESSION_MAX_AGE * 1000 }), 'utf8'), cipher.final()])
  return [iv, body, cipher.getAuthTag()].map((b) => b.toString('base64url')).join('.')
}

export function unseal(value: string | undefined, now = Date.now()): string | null {
  const [iv, body, tag] = value?.split('.') ?? []
  if (!iv || !body || !tag) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    const { a, exp } = JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')) as { a?: unknown; exp?: unknown }
    return typeof a === 'string' && typeof exp === 'number' && exp > now ? a : null
  } catch {
    return null
  }
}

/** The request's own Authorization header (curl, scripts) wins; otherwise the dashboard login cookie. */
export const credential = (req: NextRequest) => req.headers.get('authorization') || unseal(req.cookies.get(SESSION_COOKIE)?.value)

export const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`

export type LoginCheck = 'ok' | 'denied' | 'not_creator' | 'unreachable'

/** Asks the API who this credential belongs to. Only the creator login may use the dashboard. */
export async function checkLogin(base: string, authorization: string): Promise<LoginCheck> {
  try {
    const res = await fetch(`${base}/api/session`, { headers: { authorization }, cache: 'no-store' })
    if (res.status === 401) return 'denied'
    if (!res.ok) return 'unreachable'
    const { actor } = (await res.json()) as { actor?: { role?: string } }
    return actor?.role === 'creator' ? 'ok' : 'not_creator'
  } catch {
    return 'unreachable'
  }
}

export function setSession(res: NextResponse, req: NextRequest, authorization: string) {
  res.cookies.set(SESSION_COOKIE, seal(authorization), { httpOnly: true, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:', path: '/', maxAge: SESSION_MAX_AGE })
  return res
}

export function clearSession(res: NextResponse) {
  res.cookies.delete(SESSION_COOKIE)
  return res
}

/** Only same-site paths, so the login form cannot bounce to another origin. */
export const safeNext = (next: unknown) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/')
