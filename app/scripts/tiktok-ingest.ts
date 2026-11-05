/**
 * Ingest TikTok Studio CSV exports into the repo vault and regenerate the
 * snapshot Growth OS reads. Re-runnable; never hand-edit its outputs.
 *
 *   pnpm tiktok:ingest                 # read private/vault/tiktok/inbox/
 *   pnpm tiktok:ingest --from <dir>    # read another folder (copied, never moved)
 *
 * Everything lives in the gitignored private/ folder (override with GROWTH_OS_VAULT).
 * Raw files are copied once into <vault>/raw/ and never modified.
 * Files already ingested (same bytes, or same content apart from BOM/line
 * endings) are skipped. Source files are never deleted.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  daysBetweenISO,
  engagementPct,
  exportedAtFromName,
  mergeSnapshots,
  newestDataDate,
  normalizeCsv,
  parseExport,
  viewWindow,
  type ExportMeta,
  type TikTokRole,
  type TikTokSnapshot,
} from '../src/lib/tiktok.ts'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const VAULT = process.env.GROWTH_OS_VAULT ? resolve(process.env.GROWTH_OS_VAULT) : join(ROOT, 'private', 'vault', 'tiktok')
const RAW = join(VAULT, 'raw')
const INBOX = join(VAULT, 'inbox')
const STATE = join(VAULT, 'sync-state.json')
const RUNS = join(VAULT, 'sync-runs.jsonl')
const SNAPSHOT = join(VAULT, 'tiktok-snapshot.json')
const SUMMARY = join(VAULT, 'TIKTOK-STATS.md')

interface FileRecord {
  sha256: string
  contentHash: string
  role: TikTokRole
  exportedAt: string
  exportedAtSource: ExportMeta['exportedAtSource']
  originalPath: string
  ingestedAt: string
}
interface State {
  version: 1
  files: Record<string, FileRecord>
  lastRun: unknown
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const walk = (dir: string): string[] =>
  !existsSync(dir)
    ? []
    : readdirSync(dir).flatMap((f) => {
        if (f.startsWith('.')) return []
        const p = join(dir, f)
        return statSync(p).isDirectory() ? walk(p) : f.toLowerCase().endsWith('.csv') ? [p] : []
      })

const PREFIX: Record<TikTokRole, [string, string]> = {
  overview: ['Overview', 'Overview'],
  viewers: ['Viewers', 'Viewers'],
  content: ['Content', 'Content'],
  followerHistory: ['Followers', 'FollowerHistory'],
  followerActivity: ['Followers', 'FollowerActivity'],
  followerGender: ['Followers', 'FollowerGender'],
  followerTerritories: ['Followers', 'FollowerTopTerritories'],
}

const args = process.argv.slice(2)
const fromIdx = args.indexOf('--from')
const sourceDir = fromIdx >= 0 ? args[fromIdx + 1] : INBOX
if (!sourceDir) throw new Error('--from needs a folder path')

mkdirSync(RAW, { recursive: true })
mkdirSync(INBOX, { recursive: true })
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { version: 1, files: {}, lastRun: null }
const known = new Map<string, string>()
for (const [p, r] of Object.entries(state.files)) known.set(r.sha256, p).set(r.contentHash, p)

const now = new Date().toISOString()
const added: { file: string; from: string; role: TikTokRole; sha256: string }[] = []
const duplicates: { from: string; sameAs: string }[] = []
const rejected: { from: string; reason: string }[] = []

for (const src of walk(sourceDir).sort()) {
  const bytes = readFileSync(src)
  const text = bytes.toString('utf8')
  const sha256 = sha(bytes)
  const contentHash = sha(normalizeCsv(text))
  const dup = known.get(sha256) ?? known.get(contentHash)
  if (dup) {
    duplicates.push({ from: src, sameAs: dup })
    continue
  }
  const stamped = exportedAtFromName(basename(src))
  const exportedAt = stamped ?? statSync(src).mtime.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const exportedAtSource = stamped ? 'filename' : 'mtime'
  const parsed = parseExport(basename(src), text, sha256, exportedAt, exportedAtSource)
  if ('error' in parsed) {
    rejected.push({ from: src, reason: parsed.error })
    continue
  }
  const [prefix, kind] = PREFIX[parsed.meta.role]
  const stamp = exportedAt.replace(/[-:]/g, '').replace(/\.\d+/, '')
  let name = stamped ? basename(src) : `${prefix}_growth-os_${stamp}_${kind}.csv`
  for (let i = 2; existsSync(join(RAW, name)); i++) name = name.replace(/(_\d+)?\.csv$/, `_${i}.csv`)
  copyFileSync(src, join(RAW, name))
  const rel = relative(VAULT, join(RAW, name))
  state.files[rel] = { sha256, contentHash, role: parsed.meta.role, exportedAt, exportedAtSource, originalPath: src.startsWith(ROOT) ? relative(ROOT, src) : src.replace(process.env.HOME ?? '~', '~'), ingestedAt: now }
  known.set(sha256, rel).set(contentHash, rel)
  added.push({ file: rel, from: basename(src), role: parsed.meta.role, sha256 })
}

// Rebuild from every raw file so outputs never depend on run order.
const parts: TikTokSnapshot[] = []
for (const [rel, r] of Object.entries(state.files)) {
  const parsed = parseExport(basename(rel), readFileSync(join(VAULT, rel), 'utf8'), r.sha256, r.exportedAt, r.exportedAtSource)
  if (!('error' in parsed)) parts.push(parsed.snapshot)
}
const workspace = join(ROOT, 'private', 'workspace.json')
const handle = (process.env.TIKTOK_HANDLE ?? (existsSync(workspace) ? JSON.parse(readFileSync(workspace, 'utf8')).profile?.handles?.tiktok : '') ?? '').replace(/^@/, '')
const snap = { ...mergeSnapshots(...parts), handle, generatedAt: now }
const newest = newestDataDate(snap)

writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 1) + '\n')
writeFileSync(SUMMARY, summary(snap))
const run = { completedAt: now, source: sourceDir.replace(process.env.HOME ?? '~', '~'), added, duplicates: duplicates.length, rejected, newestDataDate: newest, rawFiles: Object.keys(state.files).length }
state.lastRun = run
writeFileSync(STATE, JSON.stringify(state, null, 1) + '\n')
appendFileSync(RUNS, JSON.stringify(run) + '\n')

console.log(`Added ${added.length} file(s), skipped ${duplicates.length} duplicate(s), rejected ${rejected.length}.`)
for (const r of rejected) console.log(`  rejected: ${r.from} — ${r.reason}`)
console.log(`Newest data: ${newest ?? 'none'} · ${Object.keys(state.files).length} raw files · wrote ${relative(ROOT, SNAPSHOT)}`)

function summary(s: TikTokSnapshot) {
  const f = (n: number | null | undefined, d = 0) => (n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d }))
  const pct = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`)
  const today = now.slice(0, 10)
  const nd = newestDataDate(s)
  const lastF = s.followers.at(-1)
  const lines = [
    '---',
    'generated: true',
    'generator: app/scripts/tiktok-ingest.ts — never hand-edit; drop exports in private/vault/tiktok/inbox/ and run `pnpm tiktok:ingest`',
    `updated: ${now}`,
    '---',
    '',
    `# TikTok stats${s.handle ? ` — @${s.handle}` : ''} (generated)`,
    '',
    `- Newest data point: **${nd ?? 'none'}**${nd ? ` (${daysBetweenISO(nd, today)} day(s) before this run)` : ''}`,
    `- Followers: **${f(lastF?.count)}** on ${lastF?.date ?? '—'}`,
    `- Daily views coverage: ${s.daily[0]?.date ?? '—'} → ${s.daily.at(-1)?.date ?? '—'} (${s.daily.length} days) · ${s.exports.length} export files`,
    '',
    '## Rolling windows (account-level Overview export)',
    '',
    '| Window | Views | Engagement | Views vs prior window |',
    '|---|---:|---:|---:|',
    ...[7, 14, 28].map((n) => {
      const w = viewWindow(s.daily, n)
      return `| Last ${n} days | ${f(w?.views)} | ${w?.engagement == null ? '—' : `${w.engagement.toFixed(1)}%`} | ${pct(w?.viewsChangePct)} |`
    }),
    '',
    '## Videos (latest Content export per video, lifetime totals)',
    '',
    '| Posted | Views | Likes | Comments | Shares | Engagement | Video |',
    '|---|---:|---:|---:|---:|---:|---|',
    ...s.videos.map((v) => {
      const e = v.views ? engagementPct(v.likes ?? 0, v.comments ?? 0, v.shares ?? 0, v.views) : null
      return `| ${v.postedDate ?? '—'} | ${f(v.views)} | ${f(v.likes)} | ${f(v.comments)} | ${f(v.shares)} | ${e == null ? '—' : `${e.toFixed(1)}%`} | [${v.title.replace(/\|/g, '/').slice(0, 70)}](${v.url}) |`
    }),
    '',
  ]
  return lines.join('\n')
}
