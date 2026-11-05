import { Global, Module, type DynamicModule } from '@nestjs/common'
import { AuditService } from './audit.service'
import { Store } from './store'

@Global()
@Module({})
export class DbModule {
  static forStore(store: Store): DynamicModule {
    return { module: DbModule, providers: [{ provide: Store, useValue: store }, AuditService], exports: [Store, AuditService] }
  }
}
