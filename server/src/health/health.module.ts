import { Controller, Get, Injectable, Module } from '@nestjs/common'
import { Store } from '../db/store'

@Injectable()
export class HealthService {
  constructor(private readonly store: Store) {}

  async check() {
    return { status: (await this.store.ping()) ? 'ok' : 'degraded', draftOnly: true }
  }
}

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Public (see the contract route table) and data-free: status only. */
  @Get()
  get() {
    return this.health.check()
  }
}

@Module({ controllers: [HealthController], providers: [HealthService] })
export class HealthModule {}
