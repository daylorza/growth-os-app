import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Role } from '@growth-os/contracts'
import type { Request } from 'express'

export type { Role }

/** Who is calling. `name` is the credential's name (recorded on every write); `role` decides access. */
export interface Actor {
  name: string
  role: Role
  /** Set for keys limited to the MCP endpoint. */
  scope?: 'mcp'
}

export interface WriteContext {
  actor: Actor
  /** Free-text origin of the write, e.g. "dashboard", "migration", "scheduler". */
  source: string
}

export type AuthedRequest = Request & { actor?: Actor }

export const isCreator = (a: Actor) => a.role === 'creator'

const SOURCE_MAX = 120

/** Resolves the writer and the source header for every write. The actor comes from the credential, never the body. */
export const Writer = createParamDecorator((_: unknown, ctx: ExecutionContext): WriteContext => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>()
  if (!req.actor) throw new Error('Writer used on an unauthenticated route')
  const header = req.header('x-growth-source')?.trim().slice(0, SOURCE_MAX)
  return { actor: req.actor, source: header || 'api' }
})
