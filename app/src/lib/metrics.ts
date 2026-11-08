import { PILLARS } from './labels'
import type { ContentItem, FollowerSnapshot, Pillar, Platform } from './types'

export const netFollowers = (start: number, end: number) => end - start

export const growthPct = (start: number, end: number): number | null =>
  start > 0 ? ((end - start) / start) * 100 : null

export const per1k = (count: number | undefined, views: number | undefined): number | null =>
  count == null || !views ? null : (count / views) * 1000

export const profileToFollow = (
  follows: number | undefined,
  visits: number | undefined,
  sameCohort: boolean | undefined,
): number | null => (sameCohort && follows != null && visits ? (follows / visits) * 100 : null)

export const fmt = (v: number | null | undefined, digits = 1) =>
  v == null || Number.isNaN(v) ? 'Unavailable' : v.toLocaleString('en-US', { maximumFractionDigits: digits })

export function sortedSnapshots(snaps: FollowerSnapshot[], platform: Platform) {
  return snaps.filter((s) => s.platform === platform).sort((a, b) => a.date.localeCompare(b.date))
}

export function latestSnapshot(snaps: FollowerSnapshot[], platform: Platform) {
  return sortedSnapshots(snaps, platform).at(-1)
}

export function periodChange(snaps: FollowerSnapshot[], platform: Platform, from: string, to: string) {
  const inRange = sortedSnapshots(snaps, platform).filter((s) => s.date >= from && s.date <= to)
  if (inRange.length < 2) return null
  const start = inRange[0]
  const end = inRange.at(-1)!
  return {
    start,
    end,
    net: netFollowers(start.count, end.count),
    pct: growthPct(start.count, end.count),
    verified: inRange.every((s) => s.verified),
  }
}

export function pillarMix(items: ContentItem[]) {
  const counted = items.filter((i) => i.status !== 'failed')
  const total = counted.length
  return (Object.keys(PILLARS) as Pillar[]).map((p) => {
    const n = counted.filter((i) => i.pillar === p).length
    return { pillar: p, count: n, actual: total ? (n / total) * 100 : 0, target: PILLARS[p].target }
  })
}

export function milestoneProgress(current: number | undefined, goal: number) {
  if (current == null || goal <= 0) return null
  return { pct: Math.min(100, (current / goal) * 100), remaining: Math.max(0, goal - current) }
}
