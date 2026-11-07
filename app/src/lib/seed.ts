import { BRIEF_FIELDS, UNKNOWN } from './labels'
import { addDays, nowStamp, today } from './dates'
import { privateWorkspace } from './private'
import type { AppState, BriefField, BriefKey, ContentItem, KeywordRule, Owner, Profile } from './types'

export const blankContent = (id: string, plannedDate: string): ContentItem => ({
  id,
  title: '',
  owner: 'creative',
  status: 'idea',
  platform: 'tiktok',
  plannedDate,
  pillar: 'build',
  format: 'Talking head',
  mode: 'spontaneous',
  objective: '',
  audience: '',
  hookCuriosity: '',
  hookOpinion: '',
  hookOutcome: '',
  talkingPoints: '',
  visuals: '',
  caption: '',
  hashtags: '',
  cta: '',
  xAdaptation: '',
  claimSource: '',
  approval: 'pending',
  experimentId: '',
  url: '',
  publishedAt: '',
  metrics: {},
})

const rule = (id: string, keyword: string, replyTemplate: string, demo = true): KeywordRule => ({
  id,
  keyword,
  approvedResource: '',
  resourceId: '',
  postUrls: [],
  deliveryMethod: '',
  cta: '',
  replyTemplate,
  active: false,
  demo,
})

const unknownBrief = () =>
  Object.fromEntries(BRIEF_FIELDS.map((f) => [f.key, { value: UNKNOWN, verified: false }])) as Record<BriefKey, BriefField>

export const DEFAULT_AGENTS: Profile['agents'] = {
  analyst: { name: 'Analyst', role: 'Head of Growth, Audience Intelligence and Community Engagement' },
  creative: { name: 'Creative', role: 'Creative Director, Content Strategist and Brand Architect' },
}

/** Fictional creator for the public demo. Not a real person or account. */
export const SAMPLE_PROFILE: Profile = {
  creatorName: 'Nova',
  brandName: 'NOVA_BUILDS',
  company: 'Lumen Labs',
  projectName: 'Atlas',
  handles: { tiktok: '@nova.sample', x: '@nova_sample' },
  agents: {
    analyst: { name: 'Scout', role: DEFAULT_AGENTS.analyst.role },
    creative: { name: 'Quill', role: DEFAULT_AGENTS.creative.role },
  },
  sample: true,
}

const settings = (start: string): AppState['settings'] => ({ campaignStart: start, tiktokGoal: 1000, weeklyTikTokTarget: 5, planChecks: {} })

/** A real person's empty workspace: their profile, nothing invented. */
export function createBlankSeed(profile: Profile, start: string = today()): AppState {
  const brief = unknownBrief()
  brief.approvalPolicy = { value: `Draft-only. ${profile.creatorName} approves every post, reply, message, claim and commitment.`, verified: true }
  if (profile.handles.tiktok) brief.tiktokHandle = { value: profile.handles.tiktok, verified: false }
  if (profile.handles.x) brief.xHandle = { value: profile.handles.x, verified: false }
  return {
    version: 1,
    profile: { ...profile, sample: false },
    brief,
    settings: settings(start),
    content: [],
    engagements: [],
    resources: [],
    keywords: ['AGENT', 'DEMO', 'AUTOMATION', ...(profile.projectName ? [profile.projectName.toUpperCase()] : [])].map((k, i) => rule(`K-00${i + 1}`, k, '', false)),
    snapshots: [],
    experiments: [],
    reports: [],
    leads: [],
    tasks: [],
    checkins: [],
    handoffs: [],
    tiktokImport: null,
  }
}

export function createSampleSeed(start: string = today()): AppState {
  const p = SAMPLE_PROFILE
  const brief = unknownBrief()
  brief.tiktokHandle = { value: p.handles.tiktok!, verified: true }
  brief.xHandle = { value: p.handles.x!, verified: true }
  brief.timezone = { value: 'America/New_York', verified: true }
  brief.goals = { value: `Reach the first 1,000 TikTok followers (milestone, not a guarantee). Build repeatable series and relationships for ${p.company}.`, verified: false }
  brief.idealAudience = { value: 'Busy professionals curious about AI, indie builders, small food businesses', verified: false }
  brief.approvalPolicy = { value: `Draft-only. ${p.creatorName} approves every post, reply, message, claim and commitment.`, verified: true }

  const d = (n: number) => addDays(start, n)
  const c = (id: string, n: number, patch: Partial<ContentItem>): ContentItem => ({ ...blankContent(id, d(n)), demo: true, ...patch })

  return {
    version: 1,
    profile: p,
    brief,
    settings: settings(start),
    content: [
      c('C-001', 3, {
        title: 'I let an AI plan my groceries for a week',
        status: 'draft',
        objective: `Introduce ${p.projectName} as a build-in-public anchor and earn follows from curious tech viewers.`,
        audience: 'Curious tech followers, busy professionals, indie builders',
        hookCuriosity: 'I gave an AI my calendar and my fridge. Here is the week it planned.',
        hookOpinion: 'Meal-planning apps fail because they ignore your actual schedule.',
        hookOutcome: 'Watch one prompt turn into seven dinners and a shopping list.',
        talkingPoints: `1. What ${p.projectName} does today (verified features only)\n2. The one design decision that mattered most\n3. What broke on day three`,
        visuals: 'Screen capture of the planner; fridge shot; face cam picture-in-picture',
        caption: `Building ${p.projectName} in public: one week of AI-planned dinners.`,
        hashtags: '#buildinpublic #ai #mealprep',
        cta: 'Follow to see the next build update.',
        xAdaptation: `Spent a week letting ${p.projectName} plan dinners around my calendar. The hard part was not recipes, it was knowing which nights I would actually cook. Thread →`,
        claimSource: 'NEEDS VERIFICATION: feature list and any usage numbers.',
      }),
      c('C-002', 4, { title: `The architecture behind ${p.projectName} in 60 seconds`, mode: 'educational', objective: 'Show hands-on engineering depth.', audience: 'AI builders' }),
      c('C-003', 5, { title: `What I got wrong in the first version of ${p.projectName}`, pillar: 'founder', mode: 'founder', objective: 'Credible founder story with a real lesson.', audience: 'Founders, builders' }),
      c('C-004', 6, { title: 'One agent workflow I actually use every day', pillar: 'business', mode: 'educational' }),
    ],
    engagements: [
      {
        id: 'E-001',
        platform: 'tiktok',
        sourcePost: 'Sample post',
        author: 'sample_viewer',
        comment: 'AGENT — could this work for my catering business?',
        keyword: 'AGENT',
        category: 'client_inquiry',
        draftReply: 'That sounds interesting. What process are you looking to improve?',
        status: 'drafted',
        leadId: '',
        note: 'Sample comment. Not a real person.',
        createdAt: nowStamp(),
        updatedAt: nowStamp(),
        demo: true,
      },
    ],
    resources: [],
    keywords: [
      rule('K-001', 'AGENT', 'Thanks for asking! What kind of workflow are you hoping an agent could help with?'),
      rule('K-002', p.projectName.toUpperCase(), `Glad you're curious about ${p.projectName}. Which part of the demo would you like to see next?`),
      rule('K-003', 'AUTOMATION', 'Good question. Which task are you doing by hand right now that you wish ran on its own?'),
      rule('K-004', 'DEMO', ''),
    ],
    snapshots: [],
    experiments: [
      {
        id: 'X-001',
        hypothesis: 'A demo-first opening keeps more viewers past 3 seconds than a curiosity question.',
        change: 'Opening line only (demo vs curiosity hook)',
        audiencePillar: 'Build in public',
        posts: 'C-001 and a follow-up',
        primaryMetric: 'Average watch time',
        baseline: UNKNOWN,
        window: '7 days after publish',
        result: '',
        confidence: '',
        nextAction: '',
        status: 'planned',
        demo: true,
      },
    ],
    reports: [],
    leads: [],
    tasks: [
      { id: 'T-001', title: `Record the ${p.projectName} demo`, owner: 'creator', date: start, done: false, nextSmallestAction: '', demo: true },
      { id: 'T-002', title: 'Review the TikTok script and hook', owner: 'creator', date: start, done: false, nextSmallestAction: '', demo: true },
      { id: 'T-003', title: 'Review audience comments', owner: 'creator', date: start, done: false, nextSmallestAction: '', demo: true },
    ],
    checkins: [],
    handoffs: [
      {
        id: 'H-001',
        from: 'creative',
        to: 'analyst',
        itemId: 'C-001',
        message: 'Planned post C-001. Audience: curious tech + busy professionals. Experiment X-001. Expected metric: avg watch time.',
        createdAt: nowStamp(),
        acknowledged: false,
        demo: true,
      },
    ],
    tiktokImport: null,
  }
}

/** Optional renames for data saved by older builds, kept in the private workspace (they contain names). */
export interface Migrations {
  owners?: Record<string, Owner>
  briefKeys?: Record<string, BriefKey>
  storageKeys?: string[]
}

/** Upgrade saved data: legacy owner names and brief keys, missing profile. */
export function migrateState(saved: Partial<AppState> & Record<string, unknown>, base: AppState, m: Migrations = (privateWorkspace() as { migrations?: Migrations } | undefined)?.migrations ?? {}): AppState {
  const owner = (o: string) => m.owners?.[o] ?? (o as Owner)
  const brief = { ...base.brief, ...(saved.brief ?? {}) } as Record<string, BriefField>
  for (const [old, key] of Object.entries(m.briefKeys ?? {})) {
    if (brief[old]) brief[key] = brief[old]
    delete brief[old]
  }
  const s = { ...base, ...saved, profile: saved.profile ?? base.profile, brief: brief as AppState['brief'] }
  return {
    ...s,
    content: s.content.map((c) => ({ ...c, owner: owner(c.owner) })),
    tasks: s.tasks.map((t) => ({ ...t, owner: owner(t.owner) })),
    handoffs: s.handoffs.map((h) => ({ ...h, from: owner(h.from), to: owner(h.to) })),
  }
}

/** The personal workspace from private/workspace.json when present, otherwise the fictional sample. */
export function createSeed(start: string = today()): AppState {
  const ws = privateWorkspace()
  return ws ? migrateState(ws as AppState & Record<string, unknown>, createSampleSeed(start)) : createSampleSeed(start)
}
