import { Inject, Injectable } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Actor } from '../common/actor'
import { CONFIG, type AppConfig } from '../config'

const digest = (s: string) => createHash('sha256').update(s).digest()
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b))

/**
 * Two credential kinds:
 * - HTTP Basic with the creator login (browser dashboard, curl): role creator.
 * - Bearer key, one per role (analyst, creative, creator scripts, scheduler).
 */
@Injectable()
export class CredentialsService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  authenticate(authorization: string | undefined): Actor | null {
    if (!authorization) return null
    const [scheme, value = ''] = authorization.split(' ', 2)
    if (scheme?.toLowerCase() === 'basic') {
      const decoded = Buffer.from(value, 'base64').toString('utf8')
      const i = decoded.indexOf(':')
      if (i < 0) return null
      const ok = same(decoded.slice(0, i), this.config.creatorUser) && same(decoded.slice(i + 1), this.config.creatorPass)
      return ok ? { name: this.config.creatorUser, role: 'creator' } : null
    }
    if (scheme?.toLowerCase() === 'bearer' && value) {
      // Compare against every key so timing does not reveal which one matched.
      let found: Actor | null = null
      for (const k of this.config.keys) if (same(value, k.token)) found = { name: k.name, role: k.role, ...(k.scope ? { scope: k.scope } : {}) }
      return found
    }
    return null
  }
}
