import { Global, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { AuthGuard } from './auth.guard'
import { CredentialsService } from './credentials.service'

@Global()
@Module({
  providers: [CredentialsService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [CredentialsService],
})
export class AuthModule {}
