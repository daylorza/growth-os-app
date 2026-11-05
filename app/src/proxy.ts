import { NextResponse, type NextRequest } from 'next/server'

const CHALLENGE = 'Basic realm="Growth OS", charset="UTF-8"'

/**
 * In endpoint mode every page needs a valid login. The check is delegated to the API (`/api/session`),
 * so the Next server holds no credentials. API routes and /health are authenticated by the API itself.
 * Local mode (no GROWTH_OS_API) is a localhost-only dev setup and is not gated.
 */
export async function proxy(req: NextRequest) {
  const base = process.env.GROWTH_OS_API?.trim().replace(/\/$/, '')
  if (!base) return NextResponse.next()
  const auth = req.headers.get('authorization')
  const deny = () => new NextResponse('Authentication required.', { status: 401, headers: { 'WWW-Authenticate': CHALLENGE } })
  if (!auth) return deny()
  try {
    const res = await fetch(`${base}/api/session`, { headers: { authorization: auth }, cache: 'no-store' })
    if (res.status === 401) return deny()
    if (!res.ok) return NextResponse.next()
    const { actor } = (await res.json()) as { actor?: { role?: string } }
    // The dashboard is the creator's tool. Agent tokens use the API, not the UI.
    if (actor?.role !== 'creator') return new NextResponse('The dashboard is for the creator login. Agents use /api.', { status: 403 })
  } catch {
    // API down: let the page render its offline cache.
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api/|health|_next/static|_next/image|icon.svg).*)'],
}
