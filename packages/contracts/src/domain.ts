/**
 * Document shapes for every collection: the source of truth for field names (the OpenAPI spec is generated
 * from the DTOs next to these). Every document has a string business `id` (e.g. C-001), never a database id,
 * which keeps a later move from MongoDB to relational tables straightforward.
 */
import type { Metric } from './unknown'

export const PLATFORMS = ['tiktok', 'x', 'threads'] as const
export type Platform = (typeof PLATFORMS)[number]
/** Platforms the creative agent reads and records itself (weekly). X stays with the analyst. */
export const CREATIVE_PLATFORMS = ['tiktok', 'threads'] as const satisfies readonly Platform[]
/** Where engagement comes from. Instagram is queue-only until snapshots track more than one account per platform. */
export const ENGAGEMENT_PLATFORMS = [...PLATFORMS, 'instagram'] as const
export type EngagementPlatform = (typeof ENGAGEMENT_PLATFORMS)[number]
/** Engagement platforms the creative agent queues. */
export const CREATIVE_ENGAGEMENT_PLATFORMS = [...CREATIVE_PLATFORMS, 'instagram'] as const satisfies readonly EngagementPlatform[]
export const OWNERS = ['creator', 'analyst', 'creative'] as const
export type Owner = (typeof OWNERS)[number]
/** Credential roles: the three authors plus the scheduler, which can only dispatch events. */
export const ROLES = [...OWNERS, 'worker'] as const
export type Role = (typeof ROLES)[number]

export interface WriteMeta {
  createdBy: string
  createdRole: Role
  createdAt: string
  createdSource: string
  updatedBy: string
  updatedRole: Role
  updatedAt: string
  updatedSource: string
}

export interface BaseDoc {
  id: string
  demo?: boolean
  _meta?: WriteMeta
}

export const CONTENT_STATUSES = ['idea', 'draft', 'needs_review', 'approved', 'scheduled', 'published', 'failed', 'killed'] as const
export type ContentStatus = (typeof CONTENT_STATUSES)[number]
export const APPROVALS = ['pending', 'approved', 'changes_requested'] as const
export type Approval = (typeof APPROVALS)[number]
export const PILLARS = ['build', 'commentary', 'founder', 'travel', 'business'] as const
export const MODES = ['spontaneous', 'educational', 'founder'] as const

export interface PostMetrics {
  views?: number
  avgWatchSec?: number
  completionPct?: number
  shares?: number
  saves?: number
  comments?: number
  profileVisits?: number
  follows?: number
  sameCohort?: boolean
  ageHours?: number
  measuredAt?: string
  source?: string
}

export interface ContentItem extends BaseDoc {
  title: string
  owner: Owner
  status: ContentStatus
  platform: Platform
  plannedDate: string
  pillar: (typeof PILLARS)[number]
  format: string
  mode: (typeof MODES)[number]
  objective: string
  audience: string
  hookCuriosity: string
  hookOpinion: string
  hookOutcome: string
  talkingPoints: string
  visuals: string
  caption: string
  hashtags: string
  cta: string
  xAdaptation: string
  claimSource: string
  approval: Approval
  experimentId: string
  url: string
  publishedAt: string
  metrics: PostMetrics
}

export const COMMENT_CATEGORIES = ['question', 'technical', 'appreciation', 'criticism', 'client_inquiry', 'collaboration', 'spam', 'sensitive'] as const
export const REPLY_STATUSES = ['new', 'drafted', 'approved', 'posted_by_day', 'sent_by_agent', 'escalated', 'dismissed'] as const
export type ReplyStatus = (typeof REPLY_STATUSES)[number]
/** How a reply is delivered: publicly under the comment, or as a direct message. */
export const REPLY_CHANNELS = ['comment', 'dm'] as const
export type ReplyChannel = (typeof REPLY_CHANNELS)[number]

export interface Engagement extends BaseDoc {
  platform: EngagementPlatform
  /** The creator's account it came in on, e.g. a personal or a brand handle. Empty when there is only one. */
  account: string
  sourcePost: string
  author: string
  comment: string
  keyword: string
  category: (typeof COMMENT_CATEGORIES)[number]
  draftReply: string
  /** Unset on older items: a DM campaign item is a DM, anything else a comment reply. */
  channel?: ReplyChannel
  status: ReplyStatus
  leadId: string
  note: string
  createdAt: string
  updatedAt: string
}

export const HANDOFF_TYPES = ['analysis', 'brief', 'result', 'question', 'approval'] as const
export type HandoffType = (typeof HANDOFF_TYPES)[number]

export interface Ref {
  collection: string
  id: string
}

/** The conversation between the agents and the creator. Every handoff hangs off a content item (or a daily audit id). */
export interface Handoff extends BaseDoc {
  contentItemId: string
  from: Owner
  to: Owner
  type: HandoffType
  /** Markdown. */
  body: string
  /** What this handoff is about or cites, e.g. a brief, snapshot or experiment. */
  refs: Ref[]
  createdAt: string
  acknowledgedAt?: string
  acknowledgedBy?: Owner
}

export const EXPERIMENT_STATUSES = ['planned', 'running', 'done', 'stopped'] as const
export interface Experiment extends BaseDoc {
  hypothesis: string
  change: string
  audiencePillar: string
  posts: string
  primaryMetric: string
  baseline: string
  window: string
  result: string
  confidence: string
  nextAction: string
  status: (typeof EXPERIMENT_STATUSES)[number]
  /** The content item this result was measured on. Required when an agent logs it. */
  contentItemId?: string
}

export const LEAD_TYPES = ['client_inquiry', 'collaboration', 'partnership', 'sponsor'] as const
export const LEAD_STATUSES = ['new', 'day_reviewing', 'discovery_call', 'won', 'parked', 'lost'] as const
export interface Lead extends BaseDoc {
  handle: string
  platform: EngagementPlatform | 'other'
  type: (typeof LEAD_TYPES)[number]
  status: (typeof LEAD_STATUSES)[number]
  summary: string
  nextStep: string
  source: string
  attributedRevenue?: number
  revenueEvidence: string
  createdAt: string
}

export const SNAPSHOT_SOURCE_TYPES = ['platform_export', 'platform_api', 'analyst_agent', 'creative_agent', 'manual'] as const
export interface AudienceMetrics {
  followers: Metric
  following: Metric
  posts: Metric
  views7d: Metric
  views14d: Metric
  views28d: Metric
  /** Percent, e.g. 5.8 for 5.8%. */
  engagementRate: Metric
}
/** One platform on one date. Platforms are never combined into a total. */
export interface AudienceSnapshot extends BaseDoc {
  platform: Platform
  date: string
  source: string
  sourceType: (typeof SNAPSHOT_SOURCE_TYPES)[number]
  metrics: AudienceMetrics
  verified: boolean
}

export interface KeywordRule extends BaseDoc {
  keyword: string
  approvedResource: string
  deliveryMethod: string
  cta: string
  replyTemplate: string
  active: boolean
  /** The resource the reply delivers (resources collection). */
  resourceId: string
  /** Only comments on these posts count. Empty: any post. */
  postUrls: string[]
}

/** Something the creator gives out, e.g. a guide or a product link. Agents read it; only the creator edits it. */
export interface Resource extends BaseDoc {
  name: string
  url: string
  description: string
}

export interface Task extends BaseDoc {
  title: string
  owner: Owner
  date: string
  done: boolean
  nextSmallestAction: string
}

export interface CheckIn extends BaseDoc {
  date: string
  kind: 'morning' | 'evening'
  fields: Record<string, string>
}

export interface AudienceReport extends BaseDoc {
  weekOf: string
  repeatedQuestions: string
  evidence: string
  objections: string
  requestedTopics: string
  businessSignals: string
  opportunities: string
  limitations: string
}

export interface BriefField {
  value: string
  verified: boolean
  source?: string
}

export interface AgentProfile {
  name: string
  role: string
}

export interface Profile {
  creatorName: string
  brandName: string
  company: string
  projectName: string
  handles: Record<string, string>
  agents: { analyst: AgentProfile; creative: AgentProfile }
  sample: boolean
  /** Optional private system prompt shared by both agents. Only returned to authenticated callers. */
  masterPrompt?: string
}

export interface Settings {
  campaignStart: string
  tiktokGoal: number
  weeklyTikTokTarget: number
  planChecks: Record<string, boolean>
}

/** Singleton documents live in one collection keyed by id. */
export interface Singleton<T> extends BaseDoc {
  value: T
}

/** Status of anything an agent writes: a draft until the creator decides. */
export const DRAFT_STATUSES = ['draft', 'approved', 'changes_requested', 'killed'] as const
export type DraftStatus = (typeof DRAFT_STATUSES)[number]

interface CreativeDoc extends BaseDoc {
  contentItemId: string
  status: DraftStatus
  createdAt: string
}

export interface Brief extends CreativeDoc {
  /** The analysis handoff this brief is built on. No brief without a cited source. */
  sourceHandoffId: string
  objective: string
  audience: string
  talkingPoints: string
  cta: string
  xAdaptation: string
  claimSource: string
  body: string
}

export const HOOK_KINDS = ['curiosity', 'opinion', 'outcome'] as const
export interface Hook extends CreativeDoc {
  kind: (typeof HOOK_KINDS)[number]
  text: string
}

export interface Script extends CreativeDoc {
  body: string
}

export interface Caption extends CreativeDoc {
  platform: Platform
  text: string
  hashtags: string
}

export const EVENTS = ['daily_audit', 'brief_created', 'analysis_created', 'post_published', 'measure_request', 'x_refresh', 'weekly_refresh', 'engagement_sweep', 'experiment_logged', 'approval_given'] as const
export type EventName = (typeof EVENTS)[number]

/** Body of every webhook POST. `handoffId` is the idempotency key. */
export interface WebhookPayload {
  event: EventName
  contentItemId: string
  handoffId: string
  from: Owner
  at: string
}

export const DELIVERY_STATUSES = ['pending', 'delivered', 'failed', 'no_listener'] as const
/** Outbox record for one event to one recipient. Id is `<event>:<handoffId>:<to>`, so a retry never duplicates work. */
export interface EventRecord extends BaseDoc {
  to: Owner
  payload: WebhookPayload
  status: (typeof DELIVERY_STATUSES)[number]
  attempts: number
  lastError?: string
  deliveredAt?: string
}

export const DECISIONS = ['approve', 'request_changes', 'kill'] as const
export type Decision = (typeof DECISIONS)[number]

/** One normalised card per content item: what each side said last, what waits on the creator, and the next action. */
export interface NextStep {
  contentItem: ContentItem
  latestAnalysis: Handoff | null
  latestResult: Handoff | null
  latestBrief: Brief | null
  openApprovals: Handoff[]
  overdueHandoffs: Handoff[]
  recommended: { action: string; owner: Owner }
}
