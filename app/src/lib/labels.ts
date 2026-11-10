import type {
  BriefKey,
  BriefMode,
  CommentCategory,
  ContentStatus,
  ExperimentStatus,
  LeadStatus,
  LeadType,
  Pillar,
  EngagementPlatform,
  Platform,
  ReplyChannel,
  ReplyStatus,
  TargetStatus,
} from './types'

export const PLATFORM: Record<Platform, string> = { tiktok: 'TikTok', x: 'X', threads: 'Threads' }
/** Every platform, in display order. Each is reported on its own and never added to another. */
export const PLATFORMS = Object.keys(PLATFORM) as Platform[]
export const ENGAGEMENT_PLATFORM: Record<EngagementPlatform, string> = { ...PLATFORM, instagram: 'Instagram' }

export const TARGET_STATUS: Record<TargetStatus, string> = {
  draft: 'Draft',
  approved: 'Approved, sending to Buffer',
  scheduled: 'Scheduled in Buffer',
  sent: 'Live',
  failed: 'Failed',
  cancelled: 'Cancelled',
}
export const TARGET_TONE: Record<TargetStatus, 'neutral' | 'accent' | 'ok' | 'danger'> = { draft: 'neutral', approved: 'accent', scheduled: 'accent', sent: 'ok', failed: 'danger', cancelled: 'neutral' }
/** Engagement items waiting on the creator: the Engagement Hub "Needs action" tab and the nav badge. */
export const NEEDS_ACTION: ReplyStatus[] = ['new', 'drafted', 'escalated']

export const PILLARS: Record<Pillar, { label: string; target: number; note: string }> = {
  build: { label: 'Building AI in public', target: 40, note: 'Project demos, architecture, agent workflows, lessons' },
  commentary: { label: 'AI and tech commentary', target: 25, note: 'Timely news and opinions. Verify dates and sources' },
  founder: { label: 'Founder journey', target: 15, note: 'Real stories, setbacks, discipline. No empty slogans' },
  travel: { label: 'Travel and lifestyle', target: 10, note: 'Events and places, linked to your perspective' },
  business: { label: 'Business AI education', target: 10, note: 'Real workflows, realistic benefits and limits' },
}

export const MODES: Record<BriefMode, { label: string; structure: string }> = {
  spontaneous: { label: 'Spontaneous', structure: 'One opening, three talking points, a memorable insight, a natural ending' },
  educational: { label: 'Educational', structure: 'Hook, context, problem, demonstration, takeaway, CTA' },
  founder: { label: 'Founder story', structure: 'Moment, challenge, attempt, outcome, lesson, why it matters to you' },
}

export const CONTENT_STATUS: Record<ContentStatus, string> = {
  idea: 'Idea',
  draft: 'Draft',
  needs_review: 'Needs review',
  approved: 'Approved',
  scheduled: 'Scheduled by you',
  published: 'Published',
  failed: 'Failed',
  killed: 'Killed',
}

export const CATEGORY: Record<CommentCategory, string> = {
  question: 'Genuine question',
  technical: 'Technical question',
  appreciation: 'Appreciation',
  criticism: 'Constructive criticism',
  client_inquiry: 'Client inquiry',
  collaboration: 'Collaboration',
  spam: 'Spam',
  sensitive: 'Sensitive — escalate',
}

export const REPLY_STATUS: Record<ReplyStatus, string> = {
  new: 'New',
  drafted: 'Draft ready',
  approved: 'Approved — ready to send',
  posted_by_day: 'Posted by you',
  sent_by_agent: 'Sent by the creative agent',
  escalated: 'Escalated to you',
  dismissed: 'Dismissed',
}

export const REPLY_CHANNEL: Record<ReplyChannel, string> = { comment: 'Comment reply', dm: 'Direct message' }

export const EXPERIMENT_STATUS: Record<ExperimentStatus, string> = {
  planned: 'Planned',
  running: 'Running',
  done: 'Done',
  stopped: 'Stopped',
}

export const LEAD_TYPE: Record<LeadType, string> = {
  client_inquiry: 'Client inquiry',
  collaboration: 'Collaboration',
  partnership: 'Partnership',
  sponsor: 'Sponsor',
}

export const LEAD_STATUS: Record<LeadStatus, string> = {
  new: 'New',
  day_reviewing: 'You’re reviewing',
  discovery_call: 'Discovery call',
  won: 'Won',
  parked: 'Parked',
  lost: 'Closed',
}

export const BRIEF_FIELDS: { key: BriefKey; label: string; group: string; multiline?: boolean }[] = [
  { key: 'tiktokHandle', label: 'TikTok handle / URL', group: 'Accounts' },
  { key: 'xHandle', label: 'X handle / URL', group: 'Accounts' },
  { key: 'timezone', label: 'Time zone', group: 'Capacity' },
  { key: 'availability', label: 'Weekly availability', group: 'Capacity', multiline: true },
  { key: 'goals', label: 'Goals', group: 'Direction', multiline: true },
  { key: 'idealAudience', label: 'Ideal audience', group: 'Direction', multiline: true },
  { key: 'projectEvent', label: '{project} — exact event or launch name and dates', group: '{project}' },
  { key: 'projectCapabilities', label: '{project} — verified capabilities', group: '{project}', multiline: true },
  { key: 'projectPrize', label: '{project} — awards or prize details (do not imply a win)', group: '{project}' },
  { key: 'offers', label: 'Approved business offers', group: 'Business', multiline: true },
  { key: 'landingPage', label: 'Landing page', group: 'Business' },
  { key: 'contactRoute', label: 'Contact route', group: 'Business' },
  { key: 'publicResources', label: 'Approved public resources', group: 'Business', multiline: true },
  { key: 'approvedClaims', label: 'Approved claims', group: 'Boundaries', multiline: true },
  { key: 'boundaries', label: 'Boundaries and off-limits topics', group: 'Boundaries', multiline: true },
  { key: 'analyticsAccess', label: 'Analytics, tools and integrations available', group: 'Access', multiline: true },
  { key: 'approvalPolicy', label: 'Approval policy', group: 'Access', multiline: true },
  { key: 'disclosure', label: 'Disclosure and privacy constraints', group: 'Access', multiline: true },
]

export const UNKNOWN = 'UNKNOWN'

/** Brief labels can mention the anchor project; `{project}` is replaced with the profile's project name. */
export const withProject = (text: string, projectName: string) => text.replaceAll('{project}', projectName.trim() || 'Anchor project')
