import { CONTENT_STATUS } from '../../lib/labels'
import type { ContentItem, ContentStatus } from '../../lib/types'
import { apiBase, apiGet } from '../../lib/workspace.server'

/** Server Component: content pipeline counts fetched from the endpoint at request time. */
export async function ContentPipeline() {
  if (!apiBase()) return null
  const items = await apiGet<ContentItem[]>('/api/content').catch(() => null)
  if (!items) return null
  const counts = items.reduce<Partial<Record<ContentStatus, number>>>((m, c) => ({ ...m, [c.status]: (m[c.status] ?? 0) + 1 }), {})
  return (
    <section aria-label="Content pipeline" className="mb-6 flex flex-wrap gap-2 text-xs">
      {(Object.keys(CONTENT_STATUS) as ContentStatus[]).map((s) => (
        <span key={s} className="rounded-full border border-ink-600 bg-ink-900 px-3 py-1 text-muted">
          {CONTENT_STATUS[s]} <span className="font-mono text-fg">{counts[s] ?? 0}</span>
        </span>
      ))}
    </section>
  )
}
