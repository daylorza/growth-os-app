import type { TikTokSnapshot } from './tiktok'

export type Platform = 'tiktok' | 'x' | 'threads'
/** Where engagement comes from: every platform plus Instagram (queue only). */
export type EngagementPlatform = Platform | 'instagram'
/** Workspace roles. Display names come from the profile (e.g. creator "Sam", analyst "Scout"). */
export type Owner = 'creator' | 'analyst' | 'creative'
export type Pillar = 'build' | 'commentary' | 'founder' | 'travel' | 'business'
export type BriefMode = 'spontaneous' | 'educational' | 'founder'

export type ContentStatus = 'idea' | 'draft' | 'needs_review' | 'approved' | 'scheduled' | 'published' | 'failed' | 'killed'
export type Approval = 'pending' | 'approved' | 'changes_requested'

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

export interface ContentItem {
  id: string
  title: string
  owner: Owner
  status: ContentStatus
  platform: Platform
  plannedDate: string
  pillar: Pillar
  format: string
  mode: BriefMode
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
  demo?: boolean
}

export type CommentCategory =
  | 'question'
  | 'technical'
  | 'appreciation'
  | 'criticism'
  | 'client_inquiry'
  | 'collaboration'
  | 'spam'
  | 'sensitive'

export type ReplyChannel = 'comment' | 'dm'
export type ReplyStatus = 'new' | 'drafted' | 'approved' | 'posted_by_day' | 'sent_by_agent' | 'escalated' | 'dismissed'

export interface Engagement {
  id: string
  platform: EngagementPlatform
  /** The creator's account it came in on (e.g. personal or brand). Older items have none. */
  account?: string
  sourcePost: string
  author: string
  comment: string
  keyword: string
  category: CommentCategory
  draftReply: string
  /** Unset on older items: a DM campaign item is a DM, anything else a comment reply. */
  channel?: ReplyChannel
  status: ReplyStatus
  leadId: string
  note: string
  createdAt: string
  updatedAt: string
  demo?: boolean
}

export interface KeywordRule {
  id: string
  keyword: string
  approvedResource: string
  deliveryMethod: string
  cta: string
  replyTemplate: string
  active: boolean
  /** The resource this campaign delivers. */
  resourceId?: string
  /** Only comments on these posts count. Empty or missing: any post. */
  postUrls?: string[]
  demo?: boolean
}

/** Something the creator gives out, e.g. a guide or a product link. */
export interface Resource {
  id: string
  name: string
  url: string
  description: string
  demo?: boolean
}

export interface FollowerSnapshot {
  id: string
  platform: Platform
  date: string
  count: number
  source: string
  verified: boolean
  demo?: boolean
}

export type ExperimentStatus = 'planned' | 'running' | 'done' | 'stopped'

export interface Experiment {
  id: string
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
  status: ExperimentStatus
  demo?: boolean
}

export interface AudienceReport {
  id: string
  weekOf: string
  repeatedQuestions: string
  evidence: string
  objections: string
  requestedTopics: string
  businessSignals: string
  opportunities: string
  limitations: string
  demo?: boolean
}

export type LeadType = 'client_inquiry' | 'collaboration' | 'partnership' | 'sponsor'
export type LeadStatus = 'new' | 'day_reviewing' | 'discovery_call' | 'won' | 'parked' | 'lost'

export interface Lead {
  id: string
  handle: string
  platform: EngagementPlatform | 'other'
  type: LeadType
  status: LeadStatus
  summary: string
  nextStep: string
  source: string
  attributedRevenue?: number
  revenueEvidence: string
  createdAt: string
  demo?: boolean
}

export interface Task {
  id: string
  title: string
  owner: Owner
  date: string
  done: boolean
  nextSmallestAction: string
  demo?: boolean
}

export interface CheckIn {
  id: string
  date: string
  kind: 'morning' | 'evening'
  fields: Record<string, string>
}

export interface Handoff {
  id: string
  from: Owner
  to: Owner
  itemId: string
  message: string
  createdAt: string
  acknowledged: boolean
  /** Endpoint handoff type (analysis, brief, result, question, approval). */
  type?: 'analysis' | 'brief' | 'result' | 'question' | 'approval'
  /** Records this handoff cites, e.g. the engagement item a send request is about. */
  refs?: { collection: string; id: string }[]
  demo?: boolean
  /** Set by the endpoint: who wrote it, when and from where. */
  _meta?: { createdBy: string; createdAt: string; updatedBy: string; updatedAt: string }
}

export interface BriefField {
  value: string
  verified: boolean
}

export type BriefKey =
  | 'tiktokHandle'
  | 'xHandle'
  | 'timezone'
  | 'availability'
  | 'goals'
  | 'idealAudience'
  | 'projectEvent'
  | 'projectCapabilities'
  | 'projectPrize'
  | 'offers'
  | 'landingPage'
  | 'contactRoute'
  | 'publicResources'
  | 'approvedClaims'
  | 'boundaries'
  | 'analyticsAccess'
  | 'approvalPolicy'
  | 'disclosure'

export interface Settings {
  campaignStart: string
  tiktokGoal: number
  weeklyTikTokTarget: number
  planChecks: Record<string, boolean>
}

export type ConnectorId = 'tiktok' | 'x' | 'threads' | 'instagram' | 'youtube' | 'linkedin'
/** Profile handle keys: one per platform, plus extra accounts such as a brand Instagram. */
export type HandleKey = ConnectorId | 'instagram_brand'

export interface AgentProfile {
  name: string
  role: string
}

/** Everything that makes a workspace someone's own. Stored locally, never committed. */
export interface Profile {
  creatorName: string
  brandName: string
  company: string
  projectName: string
  handles: Partial<Record<HandleKey, string>>
  agents: { analyst: AgentProfile; creative: AgentProfile }
  /** True for the fictional sample creator shown in the public demo. */
  sample: boolean
}

export interface AppState {
  version: 1
  profile: Profile
  brief: Record<BriefKey, BriefField>
  settings: Settings
  content: ContentItem[]
  engagements: Engagement[]
  keywords: KeywordRule[]
  resources: Resource[]
  snapshots: FollowerSnapshot[]
  experiments: Experiment[]
  reports: AudienceReport[]
  leads: Lead[]
  tasks: Task[]
  checkins: CheckIn[]
  handoffs: Handoff[]
  /** TikTok exports imported in this browser via Settings (the repo vault is bundled separately). */
  tiktokImport: TikTokSnapshot | null
}

export type CollectionKey = {
  [K in keyof AppState]: AppState[K] extends { id: string }[] ? K : never
}[keyof AppState]
