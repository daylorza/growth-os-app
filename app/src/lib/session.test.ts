import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as login } from '../app/auth/login/route'
import { proxy } from '../proxy'
import { forward } from './forward.server'
import { basic, safeNext, seal, SESSION_COOKIE, SESSION_MAX_AGE, unseal } from './session.server'

const GOOD = basic('creator', 'right')
const HOST = 'http://atlas:8766'

beforeEach(() => {
  process.env.GROWTH_OS_API = 'http://127.0.0.1:8767'
  process.env.GROWTH_OS_SESSION_SECRET = 'test-secret'
  // A fake API: the creator login is accepted, everything else gets a Basic challenge.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const auth = new Headers(init?.headers).get('authorization')
    if (auth !== GOOD) return new Response('{}', { status: 401, headers: { 'www-authenticate': 'Basic realm="Growth OS"' } })
    return Response.json({ actor: { role: 'creator' } })
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.GROWTH_OS_API
  delete process.env.GROWTH_OS_SESSION_SECRET
})

const withCookie = (path: string, value: string, init?: ConstructorParameters<typeof NextRequest>[1]) => {
  const req = new NextRequest(`${HOST}${path}`, init)
  req.cookies.set(SESSION_COOKIE, value)
  return req
}

describe('session cookie', () => {
  it('round-trips, and rejects tampering or expiry', () => {
    const v = seal(GOOD)
    expect(v).not.toContain('right')
    expect(unseal(v)).toBe(GOOD)
    expect(unseal(v.slice(0, -2) + (v.endsWith('A') ? 'BB' : 'AA'))).toBeNull()
    expect(unseal(v, Date.now() + SESSION_MAX_AGE * 1000 + 1)).toBeNull()
    expect(unseal('junk')).toBeNull()
  })

  it('only allows same-site return paths', () => {
    expect(safeNext('/studio?x=1')).toBe('/studio?x=1')
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', undefined]) expect(safeNext(bad)).toBe('/')
  })
})

describe('no browser login prompt', () => {
  it('a page without a login redirects to /login instead of a Basic challenge', async () => {
    const res = await proxy(new NextRequest(`${HOST}/studio`))
    expect(res.status).toBe(307)
    expect(res.headers.get('www-authenticate')).toBeNull()
    expect(res.headers.get('location')).toBe(`${HOST}/login?next=%2Fstudio`)
  })

  it('a valid session cookie opens the page and hands the credential to Server Components', async () => {
    const res = await proxy(withCookie('/', seal(GOOD)))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-request-authorization')).toBe(GOOD)
  })

  it('a stale session goes back to /login', async () => {
    const res = await proxy(withCookie('/', seal(basic('creator', 'old'))))
    expect(res.headers.get('location')).toBe(`${HOST}/login`)
  })

  it('the API pass-through uses the cookie and strips the Basic challenge for dashboard calls', async () => {
    expect((await forward(withCookie('/api/state', seal(GOOD)))).status).toBe(200)
    const denied = await forward(new NextRequest(`${HOST}/api/state`))
    expect(denied.status).toBe(401)
    expect(denied.headers.get('www-authenticate')).toBeNull()
    // A script sending its own header still gets the challenge.
    expect((await forward(new NextRequest(`${HOST}/api/state`, { headers: { authorization: 'Basic eDp5' } }))).headers.get('www-authenticate')).not.toBeNull()
  })
})

describe('POST /auth/login', () => {
  const form = (username: string, password: string, next = '/goals') => {
    const body = new FormData()
    for (const [k, v] of Object.entries({ username, password, next })) body.set(k, v)
    return new NextRequest(`${HOST}/auth/login`, { method: 'POST', body, headers: { host: 'atlas:8766', origin: HOST } })
  }

  it('sets an HttpOnly session cookie and returns to the page', async () => {
    const res = await login(form('creator', 'right'))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${HOST}/goals`)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${SESSION_COOKIE}=`)
    expect(cookie.toLowerCase()).toContain('httponly')
    expect(unseal(res.cookies.get(SESSION_COOKIE)?.value)).toBe(GOOD)
  })

  it('a wrong password goes back to the form with an error and no cookie', async () => {
    const res = await login(form('creator', 'wrong'))
    expect(res.headers.get('location')).toBe(`${HOST}/login?error=denied&next=%2Fgoals`)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('refuses a cross-site post', async () => {
    const req = form('creator', 'right')
    req.headers.set('origin', 'http://evil.example')
    expect((await login(req)).status).toBe(403)
  })
})
