import type { ContentItem, NextStep, Profile } from '@growth-os/contracts'
import { apiBase, apiGet } from '../../lib/workspace.server'
import { decisionState } from '../../lib/rules'
import { DecisionButtons } from '../DecisionButtons'

const MAX = 12
const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.slice(0, 160) ?? ''

/**
 * Server Component: one normalised "next step" card per open content item, fetched from the endpoint.
 * Approve / Request changes / Kill are the only client-side parts.
 */
export async function NextSteps() {
  if (!apiBase()) return null
  const [items, profile] = await Promise.all([apiGet<ContentItem[]>('/api/content-items').catch(() => []), apiGet<Profile>('/api/profile').catch(() => null)])
  const open = items.filter((c) => c.status !== 'killed').sort((a, b) => a.plannedDate.localeCompare(b.plannedDate)).slice(0, MAX)
  if (!open.length) return null
  const steps = await Promise.all(open.map((c) => apiGet<NextStep>(`/api/content-items/${encodeURIComponent(c.id)}/next-step`).catch(() => null)))
  const name = (o: string) => (o === 'creator' ? (profile?.creatorName ?? 'Creator') : (profile?.agents[o as 'analyst' | 'creative']?.name ?? o))

  return (
    <section aria-label="Next steps" className="mb-6">
      <h2 className="mb-3 text-base font-medium">Next step per content item</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {steps.map(
          (n) =>
            n && (
              <article key={n.contentItem.id} className="flex flex-col gap-2 rounded-2xl border border-ink-600 bg-ink-800 p-4 text-sm">
                <header className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs text-faint">{n.contentItem.id}</span>
                  <span className="font-medium">{n.contentItem.title || 'Untitled'}</span>
                  <span className="ml-auto text-xs text-muted">{n.contentItem.status}</span>
                </header>
                <p>
                  <span className="text-accent">{name(n.recommended.owner)}:</span> {n.recommended.action}
                </p>
                <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs text-muted">
                  <dt>Analysis</dt>
                  <dd>{n.latestAnalysis ? `${n.latestAnalysis.id} · ${firstLine(n.latestAnalysis.body)}` : 'None yet'}</dd>
                  <dt>Brief</dt>
                  <dd>{n.latestBrief ? `${n.latestBrief.id} · ${n.latestBrief.status}` : 'None yet'}</dd>
                  <dt>Result</dt>
                  <dd>{n.latestResult ? `${n.latestResult.id} · ${firstLine(n.latestResult.body)}` : 'None yet'}</dd>
                  <dt>Waiting on you</dt>
                  <dd>{n.openApprovals.length}</dd>
                </dl>
                {n.overdueHandoffs.length > 0 && <p className="text-xs text-warn">{n.overdueHandoffs.length} handoff(s) unread for more than 24h: {n.overdueHandoffs.map((h) => h.id).join(', ')}</p>}
                <DecisionButtons key={`${n.contentItem.id}:${n.contentItem.status}:${n.contentItem.approval}`} id={n.contentItem.id} state={decisionState(n.contentItem.status, n.contentItem.approval)} />
              </article>
            ),
        )}
      </div>
    </section>
  )
}
