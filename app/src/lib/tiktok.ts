/**
 * TikTok Studio export parsing and merging. Shared by the browser file picker
 * and `scripts/tiktok-ingest.ts`, so this file must stay dependency-free.
 *
 * TikTok CSVs write dates as "September 6" with no year. The year is inferred
 * from when the export was made: the latest such date that is not after it.
 */

export type TikTokRole =
  | 'overview'
  | 'viewers'
  | 'content'
  | 'followerHistory'
  | 'followerActivity'
  | 'followerGender'
  | 'followerTerritories'

export interface ExportMeta {
  file: string
  role: TikTokRole
  sha256: string
  exportedAt: string
  exportedAtSource: 'filename' | 'mtime'
  from: string | null
  to: string | null
  rows: number
}

type N = number | null
interface Prov {
  /** exportedAt of the file this row came from; the newer export wins on merge. */
  at: string
  file: string
}
export interface DailyRow extends Prov { date: string; views: N; profileViews: N; likes: N; comments: N; shares: N }
export interface ViewerRow extends Prov { date: string; total: N; new: N; returning: N }
export interface FollowerRow extends Prov { date: string; count: number; delta: N }
export interface VideoRow extends Prov {
  id: string
  url: string
  title: string
  postedDate: string | null
  views: N
  likes: N
  comments: N
  shares: N
  observedDate: string | null
}
export interface Share { label: string; share: number }
export interface Audience {
  gender: (Prov & { items: Share[] }) | null
  territories: (Prov & { items: Share[] }) | null
  activity: (Prov & { from: string; to: string; hours: { hour: number; avg: number }[] }) | null
}

export interface TikTokSnapshot {
  version: 1
  handle: string
  generatedAt: string
  exports: ExportMeta[]
  daily: DailyRow[]
  viewers: ViewerRow[]
  followers: FollowerRow[]
  videos: VideoRow[]
  audience: Audience
}

export const emptySnapshot = (generatedAt = ''): TikTokSnapshot => ({
  version: 1,
  handle: '',
  generatedAt,
  exports: [],
  daily: [],
  viewers: [],
  followers: [],
  videos: [],
  audience: { gender: null, territories: null, activity: null },
})

/** Strip BOM and normalise line endings: used to spot the same export saved twice. */
export const normalizeCsv = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trimEnd()

export function parseCsv(text: string): string[][] {
  const src = normalizeCsv(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  rows.push(row)
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const HEADERS: [TikTokRole, string[]][] = [
  ['overview', ['date', 'video views', 'profile views']],
  ['viewers', ['date', 'total viewers', 'new viewers']],
  ['content', ['time', 'video title', 'video link']],
  ['followerHistory', ['date', 'followers']],
  ['followerActivity', ['date', 'hour', 'active followers']],
  ['followerGender', ['gender', 'distribution']],
  ['followerTerritories', ['top territories', 'distribution']],
]

export function detectRole(header: string[]): TikTokRole | null {
  const h = header.map((c) => c.trim().toLowerCase())
  return HEADERS.find(([, req]) => req.every((r, i) => h[i] === r))?.[0] ?? null
}

/** `..._20260930T191045Z_...` → `2026-09-30T19:10:45Z` */
export function exportedAtFromName(name: string): string | null {
  const m = name.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/)
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const pad = (n: number) => String(n).padStart(2, '0')

/** "September 6" + export time → "2026-09-06". Accepts ISO dates unchanged. */
export function resolveDate(value: string, exportedAt: string): string | null {
  const v = value.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  const m = v.match(/^([A-Za-z]+)\.?\s+(\d{1,2})$/)
  if (!m) return null
  const month = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3)))
  if (month < 0) return null
  const ref = exportedAt.slice(0, 10)
  let year = Number(ref.slice(0, 4))
  const iso = (y: number) => `${y}-${pad(month + 1)}-${pad(Number(m[2]))}`
  // Allow one day of slack for time-zone differences between TikTok and the file stamp.
  const limit = new Date(Date.parse(`${ref}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  if (iso(year) > limit) year -= 1
  return iso(year)
}

const num = (s: string | undefined): N => {
  if (s == null) return null
  const t = s.replace(/[,\s%]/g, '')
  return t !== '' && Number.isFinite(Number(t)) ? Number(t) : null
}

const videoId = (url: string) => url.match(/video\/(\d+)/)?.[1] ?? url

/** TikTok video IDs carry their upload time (Unix seconds) in the top 32 bits. */
export function idTimestamp(id: string): Date | null {
  if (!/^\d{15,20}$/.test(id)) return null
  const secs = Number(BigInt(id) >> 32n)
  return secs > 1_400_000_000 && secs < 4_000_000_000 ? new Date(secs * 1000) : null
}

/**
 * "Post time" has no year. Keep TikTok's month/day (the creator's local date)
 * but take the year that lands closest to the upload time encoded in the ID.
 */
export function resolvePostedDate(value: string, id: string, exportedAt: string): string | null {
  const guess = resolveDate(value, exportedAt)
  const ts = idTimestamp(id)
  if (!guess || !ts) return guess
  const md = guess.slice(4)
  const y = ts.getUTCFullYear()
  return [y - 1, y, y + 1]
    .map((yr) => `${yr}${md}`)
    .sort((a, b) => Math.abs(Date.parse(a) - ts.getTime()) - Math.abs(Date.parse(b) - ts.getTime()))[0]
}

export interface ParsedExport {
  meta: ExportMeta
  snapshot: TikTokSnapshot
}

export function parseExport(
  file: string,
  text: string,
  sha256: string,
  exportedAt: string,
  exportedAtSource: ExportMeta['exportedAtSource'],
): ParsedExport | { error: string } {
  const [header, ...rows] = parseCsv(text)
  const role = header ? detectRole(header) : null
  if (!role) return { error: `${file}: not a recognised TikTok Studio export` }
  const at = exportedAt
  const s = emptySnapshot(exportedAt)
  const d = (v: string) => resolveDate(v, exportedAt)
  const dates: string[] = []
  const keep = <T>(date: string | null, make: (date: string) => T): T[] => {
    if (!date) return []
    dates.push(date)
    return [make(date)]
  }

  if (role === 'overview')
    s.daily = rows.flatMap((r) => keep(d(r[0]), (date) => ({ date, views: num(r[1]), profileViews: num(r[2]), likes: num(r[3]), comments: num(r[4]), shares: num(r[5]), at, file })))
  else if (role === 'viewers')
    s.viewers = rows.flatMap((r) => keep(d(r[0]), (date) => ({ date, total: num(r[1]), new: num(r[2]), returning: num(r[3]), at, file })))
  else if (role === 'followerHistory') {
    const counts = rows.map((r) => num(r[1]))
    s.followers = rows.flatMap((r, i) => {
      const count = counts[i]
      // TikTok sometimes reports a day as 0 followers next to normal days: a gap, not a real count.
      const gap = count === 0 && ((counts[i - 1] ?? 0) > 0 || (counts[i + 1] ?? 0) > 0)
      return count == null || gap ? [] : keep(d(r[0]), (date) => ({ date, count, delta: num(r[2]), at, file }))
    })
  }
  else if (role === 'content')
    s.videos = rows.flatMap((r) => {
      const url = r[2]?.trim()
      if (!url) return []
      const observedDate = d(r[0])
      if (observedDate) dates.push(observedDate)
      const id = videoId(url)
      return [{ id, url, title: (r[1] ?? '').trim(), postedDate: resolvePostedDate(r[3] ?? '', id, exportedAt), likes: num(r[4]), comments: num(r[5]), shares: num(r[6]), views: num(r[7]), observedDate, at, file }]
    })
  else if (role === 'followerActivity') {
    const byHour = new Map<number, number[]>()
    for (const r of rows) {
      const date = d(r[0])
      const hour = num(r[1])
      const active = num(r[2])
      if (!date || hour == null || active == null) continue
      dates.push(date)
      byHour.set(hour, [...(byHour.get(hour) ?? []), active])
    }
    const sorted = [...dates].sort()
    if (sorted.length)
      s.audience.activity = {
        at,
        file,
        from: sorted[0],
        to: sorted.at(-1)!,
        hours: [...byHour].sort((a, b) => a[0] - b[0]).map(([hour, v]) => ({ hour, avg: Math.round((v.reduce((x, y) => x + y, 0) / v.length) * 10) / 10 })),
      }
  } else {
    const items = rows.flatMap((r) => {
      const share = num(r[1])
      return share == null ? [] : [{ label: r[0].trim(), share }]
    })
    s.audience[role === 'followerGender' ? 'gender' : 'territories'] = { at, file, items }
  }

  const sorted = [...dates].sort()
  const meta: ExportMeta = { file, role, sha256, exportedAt, exportedAtSource, from: sorted[0] ?? null, to: sorted.at(-1) ?? null, rows: rows.length }
  s.exports = [meta]
  return { meta, snapshot: s }
}

function mergeRows<T extends Prov>(a: T[], b: T[], key: (r: T) => string): T[] {
  const m = new Map<string, T>()
  for (const r of [...a, ...b]) {
    const k = key(r)
    const prev = m.get(k)
    if (!prev || r.at >= prev.at) m.set(k, r)
  }
  return [...m.values()]
}

const newer = <T extends Prov>(a: T | null, b: T | null) => (!a ? b : !b ? a : b.at >= a.at ? b : a)

/** Combine snapshots. For any date or video, the row from the newest export wins. */
export function mergeSnapshots(...snaps: TikTokSnapshot[]): TikTokSnapshot {
  return snaps.reduce((a, b) => ({
    version: 1,
    handle: b.handle || a.handle,
    generatedAt: [a.generatedAt, b.generatedAt].sort().at(-1) ?? '',
    exports: [...new Map([...a.exports, ...b.exports].map((e) => [e.sha256, e])).values()].sort((x, y) => x.exportedAt.localeCompare(y.exportedAt) || x.file.localeCompare(y.file)),
    daily: mergeRows(a.daily, b.daily, (r) => r.date).sort((x, y) => x.date.localeCompare(y.date)),
    viewers: mergeRows(a.viewers, b.viewers, (r) => r.date).sort((x, y) => x.date.localeCompare(y.date)),
    followers: mergeRows(a.followers, b.followers, (r) => r.date).sort((x, y) => x.date.localeCompare(y.date)),
    videos: mergeRows(a.videos, b.videos, (r) => r.id).sort((x, y) => (y.postedDate ?? '').localeCompare(x.postedDate ?? '')),
    audience: {
      gender: newer(a.audience.gender, b.audience.gender),
      territories: newer(a.audience.territories, b.audience.territories),
      activity: newer(a.audience.activity, b.audience.activity),
    },
  }), emptySnapshot())
}

export function newestDataDate(s: TikTokSnapshot): string | null {
  return [s.daily.at(-1)?.date, s.followers.at(-1)?.date, s.viewers.at(-1)?.date].filter(Boolean).sort().at(-1) ?? null
}

const dayMs = 86_400_000
const shift = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10)
export const daysBetweenISO = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / dayMs)

const sum = (rows: DailyRow[], k: 'views' | 'profileViews' | 'likes' | 'comments' | 'shares') => rows.reduce((n, r) => n + (r[k] ?? 0), 0)

/** Engagement = (likes + comments + shares) / views, as a percentage. */
export const engagementPct = (likes: number, comments: number, shares: number, views: number) => (views > 0 ? ((likes + comments + shares) / views) * 100 : null)

export function viewWindow(daily: DailyRow[], days: number, end = daily.at(-1)?.date) {
  if (!end) return null
  const pick = (from: string, to: string) => daily.filter((r) => r.date >= from && r.date <= to)
  const from = shift(end, -(days - 1))
  const cur = pick(from, end)
  const prev = pick(shift(from, -days), shift(from, -1))
  const stats = (rows: DailyRow[]) => {
    const views = sum(rows, 'views')
    return { views, profileViews: sum(rows, 'profileViews'), likes: sum(rows, 'likes'), comments: sum(rows, 'comments'), shares: sum(rows, 'shares'), engagement: engagementPct(sum(rows, 'likes'), sum(rows, 'comments'), sum(rows, 'shares'), views), coveredDays: rows.length }
  }
  const c = stats(cur)
  const p = stats(prev)
  return {
    days,
    from,
    to: end,
    ...c,
    prev: p,
    // Only compare when both windows are fully covered by export data.
    viewsChangePct: c.coveredDays === days && p.coveredDays === days && p.views > 0 ? ((c.views - p.views) / p.views) * 100 : null,
  }
}

export function topActiveHours(s: TikTokSnapshot, n = 3) {
  return [...(s.audience.activity?.hours ?? [])].sort((a, b) => b.avg - a.avg).slice(0, n)
}
