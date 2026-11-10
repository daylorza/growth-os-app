/**
 * Server-side draft-only rules. This API stores drafts and records what the creator did herself.
 * It has no route or client that posts, publishes, replies or messages on any platform.
 * Agents may draft; only the creator approves, and only the creator logs something as published.
 * The one publish path is the Buffer connector (a separate worker, running with the creator's key): it schedules
 * a platform version (content target) only after the creator approved that version and its time.
 */
import { isCreator, type Actor } from './actor'
import { RuleViolation } from './collection.service'
import type { ContentItem, Engagement, Lead, Platform, PublishTarget, TargetStatus } from '@growth-os/contracts'

const isUrl = (s: string) => /^https?:\/\/\S+\.\S+/.test(s.trim())
const creatorOnly = (actor: Actor, what: string) => {
  if (!isCreator(actor)) throw new RuleViolation(`Only the creator can ${what}. Agents draft; the creator approves.`, 'forbidden')
}

export function checkContent(actor: Actor, prev: ContentItem | null, next: ContentItem) {
  if (next.approval === 'approved' && prev?.approval !== 'approved') creatorOnly(actor, 'approve content')
  if (['approved', 'scheduled', 'published', 'killed'].includes(next.status) && prev?.status !== next.status) creatorOnly(actor, `mark content ${next.status}`)
  if (next.status === 'scheduled' && next.approval !== 'approved') throw new RuleViolation('Content must be approved before it can be marked scheduled.')
  if (next.status === 'published' && (next.approval !== 'approved' || !isUrl(next.url)))
    throw new RuleViolation('Cannot log as published without creator approval and a live post URL.')
  if (next.status === 'killed' && prev?.status !== 'killed' && (next.targets ?? []).some((t) => t.status === 'approved' || t.status === 'scheduled'))
    throw new RuleViolation('Cancel the approved or scheduled platform versions before killing this item.')
  checkTargets(actor, prev, next)
}

/** The Buffer connector runs every few minutes; an approved time must leave it room to schedule. */
export const MIN_LEAD_MINUTES = 10
const PLATFORM_NAME: Record<Platform, string> = { tiktok: 'TikTok', threads: 'Threads', x: 'X' }
/** Publishing state and Buffer's metrics: written by the creator, or by the Buffer connector with her key. Never by an agent. */
const PUBLISH_FIELDS = ['status', 'bufferPostId', 'liveUrl', 'error', 'metrics'] as const
/** Key order does not matter: a client echoing the metrics back in another order has not changed them. */
const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const TRANSITIONS: Record<TargetStatus, readonly TargetStatus[]> = {
  draft: ['approved'],
  approved: ['draft', 'scheduled', 'failed', 'cancelled'],
  scheduled: ['sent', 'failed', 'cancelled'],
  sent: [],
  failed: ['draft', 'cancelled'],
  cancelled: ['draft'],
}

export const blankTarget = (platform: Platform): PublishTarget => ({ platform, caption: '', scheduledAt: '', status: 'draft', bufferPostId: '', liveUrl: '', error: '' })

/** Platform versions: agents draft captions; only the creator approves a version and its time; nothing changes once it is live. */
export function checkTargets(actor: Actor, prev: ContentItem | null, next: ContentItem, now = Date.now()) {
  const targets = next.targets ?? []
  const before = new Map((prev?.targets ?? []).map((t) => [t.platform, t]))
  if (new Set(targets.map((t) => t.platform)).size !== targets.length) throw new RuleViolation('One version per platform.')
  const inFlight = [...before.values()].some((t) => t.status === 'approved' || t.status === 'scheduled')
  if ((next.mediaUrl ?? '') !== (prev?.mediaUrl ?? '') && inFlight) throw new RuleViolation('Unapprove or cancel the approved and scheduled versions before changing the media link.')

  for (const p of before.values()) {
    if (targets.some((t) => t.platform === p.platform)) continue
    const name = PLATFORM_NAME[p.platform]
    if (p.status === 'sent') throw new RuleViolation(`The ${name} version is live. It stays as the record.`)
    if (p.bufferPostId) throw new RuleViolation(`The ${name} version is still in Buffer. Cancel it first.`)
    if (p.status !== 'draft') creatorOnly(actor, `remove the ${name} version`)
  }

  for (const t of targets) {
    const name = PLATFORM_NAME[t.platform]
    const p = before.get(t.platform)
    if (!p) {
      if (t.status !== 'draft' || t.bufferPostId || t.liveUrl || t.error || t.metrics) throw new RuleViolation(`A new ${name} version starts as a draft.`)
      continue
    }
    if (PUBLISH_FIELDS.some((k) => !same(t[k], p[k]))) creatorOnly(actor, `change the ${name} version's publishing state`)
    if (p.status === 'sent' && (t.status !== 'sent' || t.caption !== p.caption || t.scheduledAt !== p.scheduledAt || t.bufferPostId !== p.bufferPostId))
      throw new RuleViolation(`The ${name} version is live. It no longer changes.`)
    if (p.status !== 'draft' && t.status !== 'draft' && (t.caption !== p.caption || t.scheduledAt !== p.scheduledAt))
      throw new RuleViolation(`The ${name} version is ${p.status}. Unapprove or cancel it before editing.`)
    if (t.status === p.status) continue
    if (!TRANSITIONS[p.status].includes(t.status)) throw new RuleViolation(`A ${p.status} ${name} version cannot become ${t.status}.`)
    if (t.status === 'approved') {
      if (next.approval !== 'approved') throw new RuleViolation(`Approve the content item before approving its ${name} version.`)
      if (!t.caption.trim()) throw new RuleViolation(`Write the ${name} caption first.`)
      const at = Date.parse(t.scheduledAt)
      if (!Number.isFinite(at) || at < now + MIN_LEAD_MINUTES * 60_000) throw new RuleViolation(`Pick a ${name} publish time at least ${MIN_LEAD_MINUTES} minutes from now.`)
      if (t.platform === 'tiktok' && !next.mediaUrl) throw new RuleViolation('TikTok needs a video. Add the public media link first.')
    }
    if (t.status === 'scheduled' && !t.bufferPostId) throw new RuleViolation(`Only the Buffer connector marks the ${name} version scheduled, with Buffer's post id.`)
    if (t.status === 'draft' && t.bufferPostId) throw new RuleViolation(`The ${name} version is still in Buffer. Cancel it first.`)
    if (t.status === 'failed' && !t.error.trim()) throw new RuleViolation(`Say why the ${name} version failed.`)
  }
}

export function checkEngagement(actor: Actor, prev: Engagement | null, next: Engagement) {
  if (next.status === prev?.status) return
  if (next.status === 'approved') {
    creatorOnly(actor, 'approve a reply')
    if (next.category === 'sensitive') throw new RuleViolation('Sensitive items are escalated, never approved for a reply.')
    if (!next.draftReply.trim()) throw new RuleViolation('Write a draft reply first.')
  }
  if (next.status === 'posted_by_day') creatorOnly(actor, 'log a reply as posted (the creator posts it herself)')
  if (next.status === 'sent_by_agent') {
    if (actor.role !== 'creative') throw new RuleViolation('Only the creative agent marks a reply as sent by it.', 'forbidden')
    if (prev?.status !== 'approved') throw new RuleViolation('Only a reply the creator approved can be marked sent.')
    if (next.draftReply !== prev.draftReply) throw new RuleViolation('Mark the approved text as sent without changing it.')
  }
}

export function checkLead(actor: Actor, prev: Lead | null, next: Lead) {
  if (next.status === 'won' && prev?.status !== 'won') creatorOnly(actor, 'mark a lead won')
  if (next.attributedRevenue !== undefined && next.attributedRevenue !== prev?.attributedRevenue) {
    creatorOnly(actor, 'attribute revenue')
    if (!next.revenueEvidence?.trim()) throw new RuleViolation('Revenue only counts with evidence. Attach evidence first.')
  }
}

export function checkVerified(actor: Actor, prevVerified: boolean | undefined, nextVerified: boolean) {
  if (nextVerified && !prevVerified) creatorOnly(actor, 'mark data verified')
}
