/**
 * Server-side draft-only rules. This API stores drafts and records what the creator did herself.
 * It has no route or client that posts, publishes, replies or messages on any platform.
 * Agents may draft; only the creator approves, and only the creator logs something as published.
 */
import { isCreator, type Actor } from './actor'
import { RuleViolation } from './collection.service'
import type { ContentItem, Engagement, Lead } from '@growth-os/contracts'

const isUrl = (s: string) => /^https?:\/\/\S+\.\S+/.test(s.trim())
const creatorOnly = (actor: Actor, what: string) => {
  if (!isCreator(actor)) throw new RuleViolation(`Only the creator can ${what}. Agents draft; the creator approves.`, 'forbidden')
}

export function checkContent(actor: Actor, prev: ContentItem | null, next: ContentItem) {
  if (next.approval === 'approved' && prev?.approval !== 'approved') creatorOnly(actor, 'approve content')
  if (['approved', 'scheduled', 'published', 'killed'].includes(next.status) && prev?.status !== next.status) creatorOnly(actor, `mark content ${next.status}`)
  if (next.status === 'scheduled' && next.approval !== 'approved') throw new RuleViolation('Content must be approved before it can be marked scheduled.')
  if (next.status === 'published' && (next.approval !== 'approved' || !isUrl(next.url)))
    throw new RuleViolation('Cannot log as published without creator approval and a live post URL. Publishing happens outside this system.')
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
