import { PLATFORM, PLATFORMS } from '../../lib/labels'
import type { Platform } from '../../lib/types'
import { apiBase, apiGet } from '../../lib/workspace.server'

type Value = number | 'UNKNOWN'
interface Summary {
  platform: Platform
  metrics: Record<string, { start: Value; end: Value; net: Value; growthPct: Value; from: string | null; to: string | null }>
}

const ROWS: [string, string][] = [
  ['followers', 'Followers'],
  ['views28d', 'Views (28d)'],
  ['engagementRate', 'Engagement %'],
  ['following', 'Following'],
  ['posts', 'Posts'],
]
const show = (v: Value) => (typeof v === 'number' ? v.toLocaleString('en-US') : 'UNKNOWN')

/**
 * Server Component: per-platform summary straight from the endpoint's analytics layer, rendered on the server.
 * TikTok, X and Threads are separate cards and are never added together.
 */
export async function AudienceSummary() {
  if (!apiBase()) return null
  const results = await Promise.allSettled(PLATFORMS.map((p) => apiGet<Summary>(`/api/analytics/summary?platform=${p}`)))
  const summaries = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  if (!summaries.length) return null
  return (
    <section aria-label="Endpoint audience summary" className="mb-6 grid gap-4 md:grid-cols-3">
      {summaries.map((s) => (
        <div key={s.platform} className="rounded-2xl border border-ink-600 bg-ink-800 p-5">
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-base font-medium">{PLATFORM[s.platform]}</h2>
            <span className="text-xs text-faint">from the endpoint · {s.metrics.followers?.to ?? 'no data yet'}</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {ROWS.filter(([k]) => s.metrics[k]?.end !== 'UNKNOWN').map(([k, label]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd className="text-right font-mono">
                  {show(s.metrics[k].end)}
                  {typeof s.metrics[k].net === 'number' && <span className="ml-2 text-xs text-faint">({s.metrics[k].net >= 0 ? '+' : ''}{show(s.metrics[k].net)})</span>}
                </dd>
              </div>
            ))}
          </dl>
          {ROWS.every(([k]) => s.metrics[k]?.end === 'UNKNOWN') && <p className="text-sm text-muted">No {PLATFORM[s.platform]} snapshot recorded yet. Values stay UNKNOWN.</p>}
        </div>
      ))}
    </section>
  )
}
