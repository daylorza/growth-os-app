import { NextResponse, type NextRequest } from 'next/server'
import { clearSession } from '../../../lib/session.server'

export const POST = (req: NextRequest) => clearSession(NextResponse.redirect(new URL('/login', req.url), 303))
