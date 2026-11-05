import type { NextRequest } from 'next/server'
import { forward } from '../../lib/forward.server'

/**
 * Pass-through to the API's MCP endpoint. Besides `Authorization: Bearer`, the analyst's connector may send
 * its key as `?key=` here (and only here). The key is moved into the header and stripped from the URL;
 * the API authenticates every call and limits the connector key to /mcp.
 */
const handler = (req: NextRequest) => forward(req, { queryKey: true })

export { handler as GET, handler as POST, handler as DELETE }
