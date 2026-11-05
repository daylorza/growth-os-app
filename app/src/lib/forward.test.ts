import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectorAuth } from './connectorAuth'
import { forward } from './forward.server'

const KEY = 'connector-key-0123456789abcdef0123456789'

describe('connector key in the query string', () => {
  let calls: { url: string; auth: string | null }[]
  let logged: string[]
  beforeEach(() => {
    process.env.GROWTH_OS_API = 'http://127.0.0.1:8767'
    calls = []
    logged = []
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(' ')))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.GROWTH_OS_API
  })
  const upstream = (status = 200) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') })
      return new Response('{}', { status, headers: { 'content-type': 'application/json' } })
    })

  it('on /mcp, moves ?key= into a Bearer header and strips it from the URL', async () => {
    upstream()
    const res = await forward(new NextRequest(`http://atlas:8766/mcp?key=${KEY}&x=1`, { method: 'POST', body: '{}' }), { queryKey: true })
    expect(res.status).toBe(200)
    expect(calls).toEqual([{ url: 'http://127.0.0.1:8767/mcp?x=1', auth: `Bearer ${KEY}` }])
  })

  it('an Authorization header wins over ?key=', () => {
    expect(connectorAuth(`?key=${KEY}`, 'Bearer other', true)).toEqual({ search: '', authorization: 'Bearer other' })
  })

  it('on /api/* the key is ignored and still stripped, so it never reaches the API', async () => {
    upstream(401)
    const res = await forward(new NextRequest(`http://atlas:8766/api/state?key=${KEY}`))
    expect(res.status).toBe(401)
    expect(calls).toEqual([{ url: 'http://127.0.0.1:8767/api/state', auth: null }])
  })

  it('never puts the key in logs or error messages, even when the API is down', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(`connect ECONNREFUSED for /mcp?key=${KEY}`))
    const res = await forward(new NextRequest(`http://atlas:8766/mcp?key=${KEY}`, { method: 'POST', body: '{}' }), { queryKey: true })
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain(KEY)
    expect(logged.join('\n')).not.toContain(KEY)
  })
})
