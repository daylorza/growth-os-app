/**
 * One-time migration: pushes the private workspace into the endpoint and saves a receipt.
 *
 *   GROWTH_OS_API=http://host:port GROWTH_OS_USER=... GROWTH_OS_PASS=... pnpm migrate [--dry-run]
 *
 * Reads (all gitignored, all optional):
 *   private/workspace.json                    profile, brief, content, handoffs, ... (or a Settings → Export backup)
 *   private/endpoint-seed.json                extra verified records, e.g. audience snapshots with full metrics
 *   private/vault/tiktok/tiktok-snapshot.json TikTok Studio export data from `pnpm tiktok:ingest`
 *   private/brand/MASTER_AGENT_PROMPT.md      agent system prompt
 * Writes private/migrations/receipt-<time>.json. Existing ids on the endpoint are never overwritten, so it is safe to re-run.
 * Credentials come from the environment only.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PRIVATE = process.env.GROWTH_OS_PRIVATE_DIR ?? join(ROOT, 'private')
const json = (f: string) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined)

const api = process.env.GROWTH_OS_API?.replace(/\/$/, '')
const user = process.env.GROWTH_OS_USER
const pass = process.env.GROWTH_OS_PASS
if (!api || !user || !pass) {
  console.error('Set GROWTH_OS_API, GROWTH_OS_USER and GROWTH_OS_PASS in the environment.')
  process.exit(1)
}

const workspace = json(join(PRIVATE, process.env.GROWTH_OS_WORKSPACE_FILE ?? 'workspace.json')) ?? {}
const extra = json(join(PRIVATE, 'endpoint-seed.json')) ?? {}
const tiktokVault = json(join(PRIVATE, 'vault', 'tiktok', 'tiktok-snapshot.json'))
const promptFile = join(PRIVATE, 'brand', 'MASTER_AGENT_PROMPT.md')
const masterPrompt = existsSync(promptFile) ? readFileSync(promptFile, 'utf8') : undefined

const { migrations: _legacy, version: _v, tiktokImport: _t, ...state } = workspace
const merge = (k: string) => [...(state[k] ?? []), ...(extra[k] ?? [])]
const body = {
  ...state,
  profile: extra.profile ?? state.profile,
  snapshots: merge('snapshots'),
  handoffs: merge('handoffs'),
  content: merge('content'),
  ...(tiktokVault ? { tiktokVault } : {}),
  ...(masterPrompt ? { masterPrompt } : {}),
  label: 'one-time migration from private workspace',
}

const summary = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v]))
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify(summary, null, 2))
  process.exit(0)
}

const res = await fetch(`${api}/api/migrations/import`, {
  method: 'POST',
  headers: { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`, 'content-type': 'application/json', 'x-growth-source': 'migration' },
  body: JSON.stringify(body),
})
const text = await res.text()
if (!res.ok) {
  console.error(`Migration failed: ${res.status} ${text}`)
  process.exit(1)
}
const receipt = JSON.parse(text)
const dir = join(PRIVATE, 'migrations')
mkdirSync(dir, { recursive: true })
const file = join(dir, `receipt-${receipt.at.replace(/[:.]/g, '-')}.json`)
writeFileSync(file, JSON.stringify({ ...receipt, localSha256: createHash('sha256').update(JSON.stringify(body)).digest('hex'), sent: summary }, null, 2))
for (const [k, r] of Object.entries(receipt.results as Record<string, { inserted: string[]; skipped: string[] }>)) console.log(`${k.padEnd(14)} inserted ${r.inserted.length}  skipped ${r.skipped.length}`)
console.log(`Receipt ${receipt.id} saved to ${file}`)
