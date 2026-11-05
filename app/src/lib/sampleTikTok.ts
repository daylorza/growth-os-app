/**
 * Fictional TikTok data for the public demo's sample creator. Deterministic (seeded),
 * generated relative to today so the demo never looks stale. Not real account data.
 */
import { addDays, today } from './dates'
import type { DailyRow, FollowerRow, TikTokSnapshot, VideoRow, ViewerRow } from './tiktok'

const DAYS = 90
const SOURCE = 'sample-data (fictional)'

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TITLES = [
  'I let an AI plan my groceries for a week',
  'The prompt that fixed my meal plans',
  'Building a planner that reads your calendar',
  'What broke on day three of the beta',
  'One agent workflow I use every day',
  'Why most meal apps ignore your schedule',
  'Shipping a feature in one weekend',
  'My honest take on AI hype this week',
  'Turning a recipe into a shopping list automatically',
  'Founder notes: saying no to a big feature',
  'A tiny automation that saves me an hour',
  'How I test hooks before filming',
  'Building in public from a coffee shop',
  'The architecture in 60 seconds',
  'Three mistakes from my first launch',
  'What I would build with no budget',
  'Answering your questions about agents',
  'From idea to demo in 48 hours',
  'Why I keep everything draft-only',
  'A week of real numbers, no filters',
]

export function buildSampleTikTok(end: string = addDays(today(), -1)): TikTokSnapshot {
  const r = rng(42)
  const start = addDays(end, -(DAYS - 1))
  const at = `${addDays(end, 1)}T12:00:00Z`
  const prov = { at, file: SOURCE }
  const postDays = new Set(Array.from({ length: TITLES.length }, (_, i) => Math.round((i * (DAYS - 3)) / TITLES.length) + 1))

  const daily: DailyRow[] = []
  const viewers: ViewerRow[] = []
  const followers: FollowerRow[] = []
  const videos: VideoRow[] = []
  let count = 180
  let v = 0
  for (let i = 0; i < DAYS; i++) {
    const date = addDays(start, i)
    const posted = postDays.has(i)
    const spike = posted && r() > 0.7 ? 3 + r() * 3 : 1
    const views = Math.round((90 + i * 1.6 + r() * 80) * (posted ? 1.8 : 1) * spike)
    const likes = Math.round(views * (0.05 + r() * 0.03))
    const comments = Math.round(views * (0.004 + r() * 0.01))
    const shares = Math.round(views * r() * 0.006)
    daily.push({ date, views, profileViews: Math.round(views * (0.015 + r() * 0.02)), likes, comments, shares, ...prov })
    const total = Math.round(views * (0.55 + r() * 0.2))
    const returning = Math.round(total * (0.15 + r() * 0.15))
    viewers.push({ date, total, new: total - returning, returning, ...prov })
    const delta = Math.max(-1, Math.round(views / 120 + (r() - 0.4) * 2))
    count += delta
    followers.push({ date, count, delta, ...prov })
    if (posted && v < TITLES.length) {
      const life = Math.round(views * (1.6 + r() * 1.2))
      const vl = Math.round(life * (0.05 + r() * 0.05))
      videos.push({
        id: `sample-${v + 1}`,
        url: '',
        title: `${TITLES[v]} #buildinpublic #ai`,
        postedDate: date,
        views: life,
        likes: vl,
        comments: Math.round(life * (0.005 + r() * 0.01)),
        shares: Math.round(life * r() * 0.008),
        observedDate: end,
        ...prov,
      })
      v++
    }
  }
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, avg: Math.round((20 + 70 * Math.max(0, Math.sin(((hour - 9) / 24) * Math.PI * 2)) + r() * 10) * 10) / 10 }))

  return {
    version: 1,
    handle: 'nova.sample',
    generatedAt: at,
    exports: (['overview', 'viewers', 'content', 'followerHistory'] as const).map((role) => ({ file: `${SOURCE} · ${role}`, role, sha256: `sample-${role}`, exportedAt: at, exportedAtSource: 'filename' as const, from: start, to: end, rows: DAYS })),
    daily,
    viewers,
    followers,
    videos: videos.reverse(),
    audience: {
      gender: { ...prov, items: [{ label: 'Female', share: 0.52 }, { label: 'Male', share: 0.46 }, { label: 'Other', share: 0.02 }] },
      territories: { ...prov, items: [{ label: 'US', share: 0.61 }, { label: 'CA', share: 0.08 }, { label: 'GB', share: 0.06 }, { label: 'Others', share: 0.25 }] },
      activity: { ...prov, from: addDays(end, -6), to: end, hours },
    },
  }
}

export const SAMPLE_TIKTOK = buildSampleTikTok()
