import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { AppState } from './types'
import { campaignPosition, weekRange } from './dates'
import { growthPct, milestoneProgress, netFollowers, per1k, periodChange, profileToFollow } from './metrics'
import {
  isRepeatReply,
  keywordActivationError,
  keywordMatches,
  nextId,
  publishBlock,
  publishLogError,
  replyApproveError,
  replyRiskWarnings,
} from './rules'
import { createSampleSeed, migrateState } from './seed'
import type { Engagement, FollowerSnapshot } from './types'

describe('measurement formulas', () => {
  it('net followers and growth %', () => {
    expect(netFollowers(100, 160)).toBe(60)
    expect(growthPct(100, 160)).toBe(60)
  })
  it('never divides by zero', () => {
    expect(growthPct(0, 50)).toBeNull()
    expect(per1k(5, 0)).toBeNull()
    expect(per1k(undefined, 1000)).toBeNull()
    expect(profileToFollow(5, 0, true)).toBeNull()
  })
  it('per 1,000 views', () => {
    expect(per1k(12, 4000)).toBe(3)
  })
  it('profile-to-follow only when same cohort', () => {
    expect(profileToFollow(10, 200, false)).toBeNull()
    expect(profileToFollow(10, 200, true)).toBe(5)
  })
  it('period change needs two snapshots on the same platform', () => {
    const s = (id: string, platform: 'tiktok' | 'x', date: string, count: number): FollowerSnapshot => ({
      id, platform, date, count, source: 't', verified: true,
    })
    const snaps = [s('1', 'tiktok', '2026-11-01', 100), s('2', 'x', '2026-11-03', 999), s('3', 'tiktok', '2026-11-08', 130)]
    const r = periodChange(snaps, 'tiktok', '2026-11-01', '2026-11-08')!
    expect(r.net).toBe(30)
    expect(r.pct).toBe(30)
    expect(periodChange(snaps, 'x', '2026-11-01', '2026-11-08')).toBeNull()
  })
  it('milestone progress', () => {
    expect(milestoneProgress(100, 1000)).toEqual({ pct: 10, remaining: 900 })
    expect(milestoneProgress(undefined, 1000)).toBeNull()
  })
})

describe('dates', () => {
  it('campaign position', () => {
    expect(campaignPosition('2026-11-01', '2026-11-01')).toMatchObject({ day: 1, week: 1 })
    expect(campaignPosition('2026-11-01', '2026-11-08')).toMatchObject({ day: 8, week: 2 })
    expect(campaignPosition('2026-11-01', '2026-10-30').status).toBe('not_started')
    expect(campaignPosition('2026-11-01', '2026-12-15').status).toBe('complete')
  })
  it('week starts Monday', () => {
    expect(weekRange('2026-11-05')).toEqual({ start: '2026-11-02', end: '2026-11-08' })
  })
})

describe('keyword matching', () => {
  it('matches whole words only', () => {
    expect(keywordMatches('AI please', 'AI')).toBe(true)
    expect(keywordMatches('she said hi', 'AI')).toBe(false)
  })
  it('matches multi-word keywords spaced or joined', () => {
    expect(keywordMatches('night owl!', 'NIGHT OWL')).toBe(true)
    expect(keywordMatches('NIGHTOWL pls', 'NIGHT OWL')).toBe(true)
    expect(keywordMatches('night shift', 'NIGHT OWL')).toBe(false)
  })
  it('cannot activate without a real resource', () => {
    const r = createSampleSeed().keywords[0]
    expect(keywordActivationError(r)).toMatch(/approved resource/)
    expect(keywordActivationError({ ...r, approvedResource: 'Guide', deliveryMethod: 'Link in bio', cta: 'Comment AGENT' })).toBeNull()
  })
})

describe('draft-only guards', () => {
  it('publishing requires approval and a real URL, naming exactly what is missing', () => {
    const m = publishBlock('Sam')
    expect(publishLogError({ approval: 'pending', url: '' }, 'Sam')).toBe(m.both)
    expect(publishLogError({ approval: 'changes_requested', url: 'not a url' }, 'Sam')).toBe(m.both)
    expect(publishLogError({ approval: 'approved', url: '' }, 'Sam')).toBe(m.url)
    expect(publishLogError({ approval: 'approved', url: 'tiktok.com/x' }, 'Sam')).toBe(m.url)
    expect(publishLogError({ approval: 'pending', url: 'https://tiktok.com/x' }, 'Sam')).toBe(m.approval)
    expect(publishLogError({ approval: 'approved', url: 'https://www.tiktok.com/@creator/video/1' }, 'Sam')).toBeNull()
  })
  it('publish block messages use the agreed wording, with the creator name', () => {
    expect(publishBlock('Sam')).toEqual({
      both: 'Cannot log as published — this brief needs Sam approval and a live post URL first.',
      url: 'Cannot log as published — add a live post URL first.',
      approval: 'Cannot log as published — this brief needs Sam approval first.',
    })
  })
  it('sensitive comments cannot be approved', () => {
    expect(replyApproveError({ category: 'sensitive', draftReply: 'hi' }, 'Sam')).toMatch(/Escalate/)
    expect(replyApproveError({ category: 'question', draftReply: '' }, 'Sam')).toMatch(/draft/)
  })
  it('flags risky reply text', () => {
    expect(replyRiskWarnings('It costs $500', 'Sam')).toHaveLength(1)
    expect(replyRiskWarnings('I sent you a DM', 'Sam')).toHaveLength(1)
    expect(replyRiskWarnings('What are you building?', 'Sam')).toHaveLength(0)
  })
  it('detects repeated replies', () => {
    const e = { id: 'a', draftReply: 'Thanks  for asking!' } as Engagement
    expect(isRepeatReply('thanks for asking!', [e], 'b')).toBe(true)
    expect(isRepeatReply('thanks for asking!', [e], 'a')).toBe(false)
  })
  it('seed state is draft-only', () => {
    const s = createSampleSeed()
    expect(s.keywords.every((k) => !k.active)).toBe(true)
    expect(s.content.every((c) => c.status !== 'published' && c.approval === 'pending')).toBe(true)
    expect(s.engagements.every((e) => e.status !== 'posted_by_day')).toBe(true)
  })
  it('next id', () => {
    expect(nextId('C', [{ id: 'C-001' }, { id: 'C-009' }])).toBe('C-010')
    expect(nextId('C', [])).toBe('C-001')
    expect(nextId('H', [{ id: 'H-002' }, { id: 'H-DECISION-C-001-1793917743859' }, { id: 'H-AUDIT-2026-11-05' }])).toBe('H-003')
  })
})

describe('privacy', () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  const tracked = () => {
    try {
      return execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean)
    } catch {
      return [] // not a git checkout
    }
  }
  const wsFile = join(root, 'private', 'workspace.json')
  const p = existsSync(wsFile) ? (JSON.parse(readFileSync(wsFile, 'utf8')) as { profile?: AppState['profile'] }).profile : undefined

  it('keeps every personal identifier from private/workspace.json out of tracked files', () => {
    if (!p) return
    const terms = [p.brandName, p.company, p.projectName, p.agents?.analyst.name, p.agents?.creative.name, ...Object.values(p.handles ?? {}).map((h) => h?.replace(/^@/, ''))]
      .map((t) => t?.trim())
      .filter((t): t is string => !!t && t.length >= 4)
    const variants = terms.flatMap((t) => [t, t.replace(/\s+/g, ''), t.replace(/\s+/g, '_')]).map((t) => t.toLowerCase())
    const leaks = tracked()
      .filter((f) => !/\.(png|jpe?g|pdf|ico)$/i.test(f) && !/(^|\/)pnpm-lock\.yaml$/.test(f))
      .flatMap((f) => {
        const text = readFileSync(join(root, f), 'utf8').toLowerCase()
        return variants.filter((v) => text.includes(v)).map((v) => `${f}: ${v}`)
      })
    expect(leaks).toEqual([])
  })

  it('never tracks the private folder or raw exports', () => {
    expect(tracked().filter((f) => f.startsWith('private/') || /\.csv$/i.test(f))).toEqual([])
  })

  it('writes a multi-word project name with its spaces (never joined) in private notes', () => {
    if (!p?.projectName?.includes(' ')) return
    const joined = p.projectName.replace(/\s+/g, '')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        if (['node_modules', 'dist', '.git', 'raw', 'inbox'].includes(f)) continue
        const path = join(dir, f)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(tsx?|md|json)$/.test(f)) files.push(path)
      }
    }
    walk(root)
    // The one allowed mention is the instruction line that bans the joined spelling.
    const offenders = files.filter((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .some((line) => !line.includes(`Use "${p.projectName}" as two separate words`) && (line.includes(joined) || line.includes(joined.toUpperCase()))),
    )
    expect(offenders).toEqual([])
  })
})

describe('workspace migration', () => {
  it('maps legacy owner names and brief keys using the private migration table', () => {
    const base = createSampleSeed('2026-11-05')
    const legacy = {
      ...base,
      profile: undefined,
      content: [{ ...base.content[0], owner: 'Sam' }],
      tasks: [{ ...base.tasks[0], owner: 'Sam' }],
      handoffs: [{ ...base.handoffs[0], from: 'Bot A', to: 'Bot B' }],
      brief: { ...base.brief, oldProjectKey: { value: 'Launch week', verified: true } },
    } as unknown as Parameters<typeof migrateState>[0]
    const m = migrateState(legacy, base, { owners: { Sam: 'creator', 'Bot A': 'analyst', 'Bot B': 'creative' }, briefKeys: { oldProjectKey: 'projectEvent' } })
    expect(m.content[0].owner).toBe('creator')
    expect(m.tasks[0].owner).toBe('creator')
    expect([m.handoffs[0].from, m.handoffs[0].to]).toEqual(['analyst', 'creative'])
    expect(m.brief.projectEvent).toEqual({ value: 'Launch week', verified: true })
    expect('oldProjectKey' in m.brief).toBe(false)
    expect(m.profile).toEqual(base.profile)
  })
})
