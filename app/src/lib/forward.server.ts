import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { connectorAuth, KEY_SOURCE_HEADER } from './connectorAuth'
import { apiBase } from './workspace.server'

const PASS_REQUEST = ['authorization', 'content-type', 'accept', 'x-growth-client', 'x-growth-source', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id']
const PASS_RESPONSE = ['content-type', 'www-authenticate', 'allow', 'mcp-session-id', 'cache-control']

/**
 * Forwards a request to the API with the same path and query, minus any `key` parameter.
 * `queryKey` (the /mcp route only) lets the analyst's connector send its key as `?key=`.
 */
export async function forward(req: NextRequest, { queryKey = false } = {}): Promise<Response> {
  const base = apiBase()
  if (!base) return NextResponse.json({ message: 'No endpoint configured (GROWTH_OS_API). This dashboard is in local mode.' }, { status: 404 })
  const auth = connectorAuth(req.nextUrl.search, req.headers.get('authorization'), queryKey)
  const url = `${base}${req.nextUrl.pathname}${auth.search}`
  const headers = new Headers()
  for (const h of PASS_REQUEST) {
    const v = req.headers.get(h)
    if (v) headers.set(h, v)
  }
  if (auth.authorization) headers.set('authorization', auth.authorization)
  if (auth.fromQuery) headers.set(KEY_SOURCE_HEADER, 'query')
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer()
  try {
    const res = await fetch(url, { method: req.method, headers, body, cache: 'no-store', redirect: 'manual' })
    const out = new Headers()
    for (const h of PASS_RESPONSE) {
      const v = res.headers.get(h)
      if (v) out.set(h, v)
    }
    return new Response(res.body, { status: res.status, headers: out })
  } catch {
    return NextResponse.json({ message: 'The Growth OS API is unreachable.' }, { status: 502 })
  }
}
