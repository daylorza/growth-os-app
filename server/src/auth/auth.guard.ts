import { ForbiddenException, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { ROUTES, rolesFor, type RouteSpec } from '@growth-os/contracts'
import type { Response } from 'express'
import type { AuthedRequest } from '../common/actor'
import { CredentialsService } from './credentials.service'

export const CHALLENGE = 'Basic realm="Growth OS", charset="UTF-8"'

const toExpress = (p: string) => p.replace(/\{(\w+)\}/g, ':$1')
const TABLE = new Map<string, RouteSpec>(ROUTES.map((r) => [`${r.method} ${toExpress(r.path)}`, r]))

/**
 * Global guard driven by the contract route table: a route that is not in the table is refused,
 * every non-public route needs a credential, and the caller's role must be allowed on that route.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly credentials: CredentialsService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>()
    const spec = TABLE.get(`${req.method} ${req.route?.path}`)
    if (spec?.public) return true
    const actor = this.credentials.authenticate(req.header('authorization'))
    if (!actor) {
      ctx.switchToHttp().getResponse<Response>().setHeader('WWW-Authenticate', CHALLENGE)
      throw new UnauthorizedException()
    }
    if (!spec) throw new ForbiddenException('This route is not in the API contract.')
    if (actor.scope === 'mcp' && spec.path !== '/mcp') throw new ForbiddenException('This key only works on /mcp.')
    if (!rolesFor(spec).includes(actor.role)) throw new ForbiddenException(`The ${actor.role} role cannot call ${spec.method} ${spec.path}.`)
    // The dashboard identifies itself so writes are attributed to it rather than to a manual API call.
    req.actor = actor.role === 'creator' && req.header('x-growth-client') === 'dashboard' ? { ...actor, name: 'dashboard' } : actor
    return true
  }
}
