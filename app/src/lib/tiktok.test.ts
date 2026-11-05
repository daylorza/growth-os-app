import { describe, expect, it } from 'vitest'
import {
  detectRole,
  exportedAtFromName,
  mergeSnapshots,
  newestDataDate,
  parseCsv,
  parseExport,
  resolveDate,
  resolvePostedDate,
  viewWindow,
} from './tiktok'
import { combinedSnapshots, dataAge } from './tiktokData'
import { PRIVATE_TIKTOK } from './private'
import { buildSampleTikTok } from './sampleTikTok'
import type { FollowerSnapshot } from './types'

const AT = '2026-11-05T12:00:00Z'
/** A synthetic TikTok-style ID whose top 32 bits encode the given upload time. */
const fakeId = (iso: string) => String(BigInt(Date.parse(iso) / 1000) << 32n)
const ok = (r: ReturnType<typeof parseExport>) => {
  if ('error' in r) throw new Error(r.error)
  return r.snapshot
}

describe('CSV parsing', () => {
  it('handles BOM, CRLF, quoted commas and escaped quotes', () => {
    expect(parseCsv('\uFEFF"a","b, c"\r\n"say ""hi""","2"\r\n')).toEqual([['a', 'b, c'], ['say "hi"', '2']])
  })
  it('detects each TikTok Studio export role from its header', () => {
    expect(detectRole(['Date', 'Video Views', 'Profile Views', 'Likes', 'Comments', 'Shares'])).toBe('overview')
    expect(detectRole(['Date', 'Total Viewers', 'New Viewers', 'Returning Viewers'])).toBe('viewers')
    expect(detectRole(['Time', 'Video title', 'Video link', 'Post time'])).toBe('content')
    expect(detectRole(['Date', 'Followers', 'Difference in followers from previous day'])).toBe('followerHistory')
    expect(detectRole(['Date', 'Hour', 'Active followers'])).toBe('followerActivity')
    expect(detectRole(['Gender', 'Distribution'])).toBe('followerGender')
    expect(detectRole(['Top territories', 'Distribution'])).toBe('followerTerritories')
    expect(detectRole(['name', 'email'])).toBeNull()
  })
  it('reads the export time from the file name', () => {
    expect(exportedAtFromName('Overview_export_20260930T191045Z_Overview.csv')).toBe('2026-09-30T19:10:45Z')
    expect(exportedAtFromName('Overview.csv')).toBeNull()
  })
})

describe('year inference', () => {
  it('uses the latest matching date not after the export', () => {
    expect(resolveDate('November 4', AT)).toBe('2026-11-04')
    expect(resolveDate('November 6', AT)).toBe('2026-11-06') // one day of time-zone slack
    expect(resolveDate('December 7', AT)).toBe('2025-12-07')
    expect(resolveDate('2026-01-02', AT)).toBe('2026-01-02')
    expect(resolveDate('not a date', AT)).toBeNull()
  })
  it('takes the post year from the TikTok video ID', () => {
    // Posted March 2024: a year-less "March 16" must not become 2026.
    expect(resolvePostedDate('March 16', fakeId('2024-03-16T21:00:00Z'), AT)).toBe('2024-03-16')
    expect(resolvePostedDate('October 26', fakeId('2026-10-26T16:00:00Z'), AT)).toBe('2026-10-26')
  })
})

const overview = (rows: string, at = AT, file = 'Overview.csv') =>
  ok(parseExport(file, `"Date","Video Views","Profile Views","Likes","Comments","Shares"\n${rows}`, file + at, at, 'filename'))

describe('merging exports', () => {
  it('lets the newest export win for the same day', () => {
    const old = overview('"November 1","100","1","1","0","0"', '2026-11-02T00:00:00Z', 'a.csv')
    const neu = overview('"November 1","120","1","1","0","0"\n"November 2","50","0","0","0","0"', '2026-11-03T00:00:00Z', 'b.csv')
    for (const m of [mergeSnapshots(old, neu), mergeSnapshots(neu, old)]) {
      expect(m.daily.map((d) => [d.date, d.views])).toEqual([['2026-11-01', 120], ['2026-11-02', 50]])
      expect(m.exports).toHaveLength(2)
    }
  })
  it('computes rolling windows and only compares fully covered windows', () => {
    const rows = Array.from({ length: 14 }, (_, i) => `"October ${i + 1}","${i < 7 ? 100 : 200}","1","10","5","5"`).join('\n')
    const w = viewWindow(overview(rows).daily, 7)!
    expect(w).toMatchObject({ from: '2026-10-08', to: '2026-10-14', views: 1400, viewsChangePct: 100 })
    expect(w.engagement).toBeCloseTo((140 / 1400) * 100)
    expect(viewWindow(overview(rows).daily, 14)!.viewsChangePct).toBeNull()
  })
})

describe('Growth OS follower snapshots', () => {
  const tk = mergeSnapshots(
    ok(parseExport('f.csv', '"Date","Followers","Difference in followers from previous day"\n"November 3","510","5"\n"November 4","510","0"', 'x', AT, 'filename')),
  )
  const manual: FollowerSnapshot[] = [
    { id: 'S-001', platform: 'tiktok', date: '2026-11-05', count: 100, source: 'demo', verified: false, demo: true },
    { id: 'S-002', platform: 'x', date: '2026-11-05', count: 40, source: 'manual', verified: true },
    { id: 'S-003', platform: 'tiktok', date: '2026-11-04', count: 999, source: 'typo', verified: false },
  ]
  it('replaces the demo baseline and same-day manual entries with verified export history', () => {
    const c = combinedSnapshots(manual, tk)
    expect(c.find((x) => x.demo)).toBeUndefined()
    expect(c.find((x) => x.id === 'S-003')).toBeUndefined()
    expect(c.find((x) => x.platform === 'x')?.count).toBe(40)
    expect(c.filter((x) => x.platform === 'tiktok').every((x) => x.verified)).toBe(true)
  })
  it('treats a lone 0-follower day from TikTok as a gap, not a real drop', () => {
    const f = ok(parseExport('g.csv', '"Date","Followers","Difference in followers from previous day"\n"August 22","120","3"\n"August 23","0","-120"\n"August 24","124","124"', 'g', AT, 'filename'))
    expect(f.followers.map((x) => x.count)).toEqual([120, 124])
    const edge = ok(parseExport('h.csv', '"Date","Followers","Difference in followers from previous day"\n"August 23","0","-120"\n"August 24","124","124"', 'h', AT, 'filename'))
    expect(edge.followers.map((x) => x.count)).toEqual([124])
  })
  it('flags data older than 7 days as stale', () => {
    expect(dataAge(tk, '2026-11-05')).toEqual({ newest: '2026-11-04', days: 1, stale: false })
    expect(dataAge(tk, '2026-11-12')?.stale).toBe(true)
  })
})

describe('sample creator data', () => {
  it('is fictional, deterministic and always fresh', () => {
    const a = buildSampleTikTok('2026-11-04')
    expect(a).toEqual(buildSampleTikTok('2026-11-04'))
    expect(newestDataDate(a)).toBe('2026-11-04')
    expect(a.videos.every((v) => v.url === '' && v.id.startsWith('sample-'))).toBe(true)
    expect(a.followers.at(-1)!.count).toBeGreaterThan(a.followers[0].count)
  })
})

describe('private vault snapshot (when present)', () => {
  it('is internally consistent', () => {
    if (!PRIVATE_TIKTOK) return
    const s = PRIVATE_TIKTOK
    expect(newestDataDate(s)).not.toBeNull()
    expect(s.followers.some((f) => f.count === 0)).toBe(false)
    expect(new Set(s.exports.map((e) => e.sha256)).size).toBe(s.exports.length)
    expect(s.videos.every((v) => !v.postedDate || v.postedDate <= s.generatedAt.slice(0, 10))).toBe(true)
  })
})
