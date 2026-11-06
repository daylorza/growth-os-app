import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import type { AppConfig } from './config'
import type { Store } from './db/store'

/** Builds the Nest app on its default Express adapter. Shared by main.ts and the tests. */
export async function createApp(config: AppConfig, store: Store, logger = true) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.create(config, store), { logger: logger ? ['error', 'warn'] : false, bodyParser: false })
  app.useBodyParser('json', { limit: '10mb' })
  app.disable('x-powered-by')
  app.enableShutdownHooks()
  return app
}
