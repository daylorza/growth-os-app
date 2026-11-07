import type { ContentItem, Engagement, Handoff, KeywordRule } from './types'

/** Tokenize text into uppercase alphanumeric words. */
const tokens = (s: string): string[] => s.toUpperCase().match(/[A-Z0-9]+/g) ?? []

/**
 * A keyword matches as a whole word or phrase. Multi-word keywords also match
 * when typed joined together (people often drop the space in comments).
 */
export function keywordMatches(comment: string, keyword: string) {
  const c = tokens(comment)
  const k = tokens(keyword)
  if (!k.length) return false
  const joined = k.join('')
  if (c.includes(joined)) return true
  return c.some((_, i) => k.every((t, j) => c[i + j] === t))
}

/** A post link reduced to what identifies it: the video id when there is one, else the URL without query or trailing slash. */
export const postKey = (url: string) => /\/video\/(\d+)/.exec(url)?.[1] ?? url.trim().split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase()

/** Whether a campaign applies to a comment on this post. A campaign without posts applies everywhere. */
export const postMatches = (r: KeywordRule, sourcePost: string) =>
  !r.postUrls?.length || (!!sourcePost.trim() && r.postUrls.some((u) => postKey(u) === postKey(sourcePost)))

export const matchKeywords = (comment: string, rules: KeywordRule[], sourcePost = '') =>
  rules.filter((r) => keywordMatches(comment, r.keyword) && postMatches(r, sourcePost))

/** The active DM campaign an engagement item belongs to: its keyword, on one of the campaign's posts. */
export const campaignFor = (e: Pick<Engagement, 'keyword' | 'sourcePost'>, rules: KeywordRule[]) =>
  rules.find((r) => r.active && /\bdm\b/i.test(r.deliveryMethod) && e.keyword.trim() && keywordMatches(e.keyword, r.keyword) && postMatches(r, e.sourcePost))

const person = (s: string) => s.trim().replace(/^@/, '').toLowerCase()

/** Other queue items for the same person on the same platform: a DM already queued, approved or sent. Dismissed items do not count. */
export const sameRecipient = (e: Engagement, all: Engagement[]) =>
  person(e.author) ? all.filter((o) => o.id !== e.id && o.platform === e.platform && person(o.author) === person(e.author) && o.status !== 'dismissed') : []

/** A campaign's starting reply for one person: {name} becomes their name or handle. */
export const fillTemplate = (template: string, name: string) => template.replaceAll('{name}', name.replace(/^@/, '').trim() || 'there')

/** A keyword campaign can only go live once there is something real to deliver. */
export function keywordActivationError(r: KeywordRule): string | null {
  const missing = [
    !r.approvedResource.trim() && 'an approved resource',
    !r.deliveryMethod.trim() && 'a delivery method',
    !r.cta.trim() && 'the exact CTA',
  ].filter(Boolean)
  return missing.length ? `Add ${missing.join(', ')} before activating.` : null
}

const isUrl = (s: string) => /^https?:\/\/\S+\.\S+/.test(s.trim())

/** Publishing happens outside this app. Logging it requires the creator's approval and the real link. */
export const publishBlock = (who: string) =>
  ({
    both: `Cannot log as published — this brief needs ${who} approval and a live post URL first.`,
    url: 'Cannot log as published — add a live post URL first.',
    approval: `Cannot log as published — this brief needs ${who} approval first.`,
  }) as const

export function publishLogError(item: Pick<ContentItem, 'approval' | 'url'>, who: string): string | null {
  const msg = publishBlock(who)
  const approved = item.approval === 'approved'
  const hasUrl = isUrl(item.url)
  if (!approved && !hasUrl) return msg.both
  if (!hasUrl) return msg.url
  if (!approved) return msg.approval
  return null
}

export function scheduleError(item: Pick<ContentItem, 'approval'>, who: string): string | null {
  return item.approval === 'approved' ? null : `${who} must approve this item before it can be marked scheduled.`
}

export function replyApproveError(e: Pick<Engagement, 'draftReply' | 'category'>, who: string): string | null {
  if (e.category === 'sensitive') return `Sensitive items go to ${who}. Escalate instead of approving a reply.`
  if (!e.draftReply.trim()) return 'Write a draft reply first.'
  return null
}

/** Flags a reply that repeats one already used, so replies stay non-repetitive. */
export function isRepeatReply(draft: string, others: Engagement[], selfId: string) {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  const d = norm(draft)
  return !!d && others.some((o) => o.id !== selfId && norm(o.draftReply) === d)
}

/** Text a reply must never contain: no prices, no promised DMs or delivery times. */
export function replyRiskWarnings(draft: string, who: string): string[] {
  const out: string[] = []
  if (/[$€£]\s?\d|\bprice\b|\bquote\b/i.test(draft)) out.push(`Mentions pricing. Do not quote prices without ${who}’s approval.`)
  if (/\b(dm|dm'd|messaged|sent you|check your (inbox|dms?))\b/i.test(draft))
    out.push('Mentions a DM. Only promise a DM if delivery is real and approved.')
  if (/\b(within|in) \d+ ?(min|minutes|hours?|hrs?)\b/i.test(draft)) out.push('Promises a response time.')
  if (/\bguarantee/i.test(draft)) out.push('Contains a guarantee.')
  return out
}

/** Next sequential id like C-010. Only ids of exactly that form count (not e.g. H-AUDIT-2026-11-05). */
export const nextId = (prefix: string, existing: { id: string }[]) => {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`)
  const max = existing.reduce((m, e) => {
    const n = Number(pattern.exec(e.id)?.[1])
    return Number.isFinite(n) && n > m ? n : m
  }, 0)
  return `${prefix}-${String(max + 1).padStart(3, '0')}`
}

const DAY_MS = 86_400_000
/** A handoff nobody acknowledged within 24 hours is flagged in the dashboard. */
export const isOverdue = (h: Pick<Handoff, 'acknowledged' | 'createdAt'>, now = Date.now()) => !h.acknowledged && now - Date.parse(h.createdAt) > DAY_MS

export type DecisionState = 'approved' | 'changes_requested' | 'killed' | 'open'

/** Where an item stands for the creator's decision buttons. A decision already made is shown greyed out. */
export const decisionState = (status: string, approval: string): DecisionState =>
  status === 'killed' ? 'killed' : approval === 'approved' && status !== 'needs_review' ? 'approved' : approval === 'changes_requested' ? 'changes_requested' : 'open'
