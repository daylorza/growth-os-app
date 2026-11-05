import type { NextRequest } from 'next/server'
import { forward } from '../../lib/forward.server'

const handler = (req: NextRequest) => forward(req)

export { handler as GET }
