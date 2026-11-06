import { Logger } from '@nestjs/common'
import { createApp } from './bootstrap'
import { loadConfig } from './config'
import { MemoryStore } from './db/memory.store'
import { MongoStore } from './db/mongo.store'

async function main() {
  const config = loadConfig()
  const log = new Logger('growth-os')
  const store = config.mongoUrl ? await MongoStore.connect(config.mongoUrl, config.mongoDb) : new MemoryStore()
  if (!config.mongoUrl) log.warn('GROWTH_OS_MONGO_URL is not set: using an in-memory store. Data is lost on restart.')
  const app = await createApp(config, store)
  await app.listen(config.port, config.host)
  console.log(`Growth OS API listening on http://${config.host}:${config.port} (draft-only, ${config.keys.length} key(s), webhooks: ${Object.keys(config.webhooks).join(', ') || 'none'})`)
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
