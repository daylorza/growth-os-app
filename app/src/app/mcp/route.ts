import type { NextRequest } from 'next/server'
import { forward } from '../../lib/forward.server'

/** Pass-through to the API's MCP endpoint (analyst key only; the API authenticates every call). */
const handler = (req: NextRequest) => forward(req)

export { handler as GET, handler as POST, handler as DELETE }
