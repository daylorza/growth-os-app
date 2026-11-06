/** Structured part of an analyst audit. The model is asked to end its reply with this JSON in a ```json fence. */
export interface AnalystAudit {
  report: string
  xSnapshot: { date: string; followers?: number; following?: number; posts?: number } | null
  engagementQueue: { sourcePost?: string; author?: string; comment: string; keyword?: string; category?: string; draftReply?: string }[]
}

const CATEGORIES = new Set(['question', 'technical', 'appreciation', 'criticism', 'client_inquiry', 'collaboration', 'spam', 'sensitive'])
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
const str = (v: unknown, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : undefined)

/**
 * Reads an analyst reply (live API output or text pasted by the creator). The whole text is the report;
 * a trailing ```json block, if present and valid, adds a snapshot and engagement drafts. Never invents values:
 * anything missing or malformed is dropped, not defaulted.
 */
export function parseAnalystReply(text: string): AnalystAudit {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)]
  const last = blocks.at(-1)
  let data: Record<string, unknown> = {}
  if (last) {
    try {
      data = JSON.parse(last[1]) as Record<string, unknown>
    } catch {
      data = {}
    }
  }
  const report = (str(data.report, 100_000) ?? (last ? text.replace(last[0], '') : text)).trim()
  const snap = data.xSnapshot as Record<string, unknown> | null | undefined
  const date = str(snap?.date)
  const xSnapshot =
    snap && date && /^\d{4}-\d{2}-\d{2}$/.test(date) && [snap.followers, snap.following, snap.posts].some((v) => num(v) !== undefined)
      ? { date, followers: num(snap.followers), following: num(snap.following), posts: num(snap.posts) }
      : null
  const queue = Array.isArray(data.engagementQueue) ? (data.engagementQueue as Record<string, unknown>[]) : []
  const engagementQueue = queue
    .filter((e) => e && typeof e.comment === 'string' && e.comment.trim())
    .slice(0, 50)
    .map((e) => ({
      sourcePost: str(e.sourcePost, 2000),
      author: str(e.author, 200),
      comment: str(e.comment)!,
      keyword: str(e.keyword, 200),
      category: typeof e.category === 'string' && CATEGORIES.has(e.category) ? e.category : undefined,
      draftReply: str(e.draftReply),
    }))
  return { report: report || text.trim(), xSnapshot, engagementQueue }
}
