import { NextResponse, type NextRequest } from 'next/server'
import { checkLogin, clearSession, credential } from './lib/session.server'

/**
 * In endpoint mode every page needs a valid login. The check is delegated to the API (`/api/session`),
 * so the Next server holds no credentials. /api, /mcp and /health are authenticated by the API itself.
 * Local mode (no GROWTH_OS_API) is a localhost-only dev setup and is not gated.
 * Without a login the browser goes to the in-app /login page (never the browser's Basic-auth prompt).
 */
export async function proxy(req: NextRequest) {
  const base = process.env.GROWTH_OS_API?.trim().replace(/\/$/, '')
  if (!base) return NextResponse.next()
  const toLogin = () => {
    const url = new URL('/login', req.url)
    const next = `${req.nextUrl.pathname}${req.nextUrl.search}`
    if (next !== '/') url.searchParams.set('next', next)
    return clearSession(NextResponse.redirect(url))
  }
  const auth = credential(req)
  if (!auth) return toLogin()
  const check = await checkLogin(base, auth)
  if (check === 'denied') return toLogin()
  // The dashboard is the creator's tool. Agent tokens use the API, not the UI.
  if (check === 'not_creator') return new NextResponse('The dashboard is for the creator login. Agents use /api.', { status: 403 })
  // API down: let the page render its offline cache. Server Components read the credential from this header.
  const headers = new Headers(req.headers)
  headers.set('authorization', auth)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ['/((?!api/|mcp|health|login|auth/|_next/static|_next/image|icon.svg).*)'],
}
