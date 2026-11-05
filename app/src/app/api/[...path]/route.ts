import type { NextRequest } from 'next/server'
import { forward } from '../../../lib/forward.server'

/**
 * Same-origin pass-through to the NestJS API. The caller's own Authorization header is forwarded
 * unchanged; the API authenticates every call. This route adds nothing and stores nothing.
 */
const handler = (req: NextRequest) => forward(req)

export { handler as GET, handler as POST, handler as PATCH, handler as PUT, handler as DELETE }
