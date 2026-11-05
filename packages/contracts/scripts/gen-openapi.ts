/** Writes openapi.json from the DTOs. With --check, fails if the committed file is out of date. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildOpenApi } from '../src'

const file = join(__dirname, '..', '..', 'openapi.json')
const next = `${JSON.stringify(buildOpenApi(), null, 2)}\n`
if (process.argv.includes('--check')) {
  const current = readFileSync(file, 'utf8')
  if (current !== next) {
    console.error('openapi.json is out of date. Run `pnpm openapi` and commit the result.')
    process.exit(1)
  }
  console.log('openapi.json is up to date.')
} else {
  writeFileSync(file, next)
  console.log(`Wrote ${file}`)
}
