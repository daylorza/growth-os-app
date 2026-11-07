import { NextResponse, type NextRequest } from 'next/server'
import { basic, checkLogin, safeNext, setSession } from '../../../lib/session.server'
import { apiBase } from '../../../lib/workspace.server'

/** The /login form posts here. The API checks the credential; on success it is sealed into the session cookie. */
export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  if (origin && new URL(origin).host !== req.headers.get('host')) return new NextResponse('Cross-site login refused.', { status: 403 })
  const form = await req.formData()
  const next = safeNext(form.get('next'))
  const back = (error: string) => {
    const url = new URL('/login', req.url)
    url.searchParams.set('error', error)
    if (next !== '/') url.searchParams.set('next', next)
    return NextResponse.redirect(url, 303)
  }
  const base = apiBase()
  if (!base) return NextResponse.redirect(new URL(next, req.url), 303)
  const auth = basic(String(form.get('username') ?? ''), String(form.get('password') ?? ''))
  const check = await checkLogin(base, auth)
  if (check !== 'ok') return back(check)
  return setSession(NextResponse.redirect(new URL(next, req.url), 303), req, auth)
}
