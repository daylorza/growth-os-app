'use client'

import { useState } from 'react'
import { Badge, Button, Card, CardTitle, Empty, Notice } from '../components/ui'
import { addDays, shortDate } from '../lib/dates'
import { fmt } from '../lib/metrics'
import { engagementPct, topActiveHours, viewWindow, type TikTokSnapshot } from '../lib/tiktok'
import { dataAge } from '../lib/tiktokData'


const pct = (v: number | null | undefined, signed = false) => (v == null ? '—' : `${signed && v > 0 ? '+' : ''}${v.toFixed(1)}%`)
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`

export function FreshnessNotice({ tk }: { tk: TikTokSnapshot }) {
  const age = dataAge(tk)
  if (!age) return <Notice>No TikTok export imported yet. Download a four-role export from TikTok Studio and import it in Settings.</Notice>
  if (!age.stale) return null
  return (
    <Notice>
      TikTok numbers are {age.days} days old (newest data {shortDate(age.newest)}). Download a fresh four-role export from TikTok Studio (Overview, Content, Viewers, Followers),
      drop it in <code>private/vault/tiktok/inbox/</code> and run <code>pnpm tiktok:ingest</code>, or import it in Settings.
    </Notice>
  )
}

export default function TikTokStudio({ tk }: { tk: TikTokSnapshot }) {
  const [showAll, setShowAll] = useState(false)
  const age = dataAge(tk)
  const windows = [7, 14, 28].map((n) => viewWindow(tk.daily, n)).filter((w) => w != null)
  const followerAt = (date: string) => [...tk.followers].reverse().find((f) => f.date <= date)?.count
  const viewers28 = tk.viewers.slice(-28)
  const ret = viewers28.reduce((n, v) => n + (v.returning ?? 0), 0)
  const tot = viewers28.reduce((n, v) => n + (v.new ?? 0) + (v.returning ?? 0), 0)
  const hours = topActiveHours(tk)
  const videos = showAll ? tk.videos : tk.videos.slice(0, 12)
  const latestContent = [...tk.exports].filter((e) => e.role === 'content').sort((a, b) => a.exportedAt.localeCompare(b.exportedAt)).at(-1)

  return (
    <Card className="mt-4">
      <CardTitle right={age && <Badge tone={age.stale ? 'warn' : 'ok'}>{age.days === 0 ? 'Data from today' : `Data ${age.days} day${age.days === 1 ? '' : 's'} old`}</Badge>}>
        TikTok Studio exports
      </CardTitle>
      <FreshnessNotice tk={tk} />
      {age && (
        <>
          <p className="mb-4 text-xs text-muted">
            Newest data {shortDate(age.newest)} · {tk.exports.length} export files · account-level daily views from the Overview export. Engagement = (likes + comments + shares) / views.
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            {windows.map((w) => {
              const fStart = followerAt(addDays(w.from, -1))
              const fEnd = followerAt(w.to)
              return (
                <div key={w.days} className="rounded-xl border border-ink-600 bg-ink-900 p-4">
                  <div className="text-xs text-muted">Last {w.days} days · {shortDate(w.from)}–{shortDate(w.to)}</div>
                  <div className="mt-2 text-2xl font-semibold tabular-nums">{fmt(w.views, 0)} <span className="text-sm font-normal text-muted">views</span></div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div><dt className="text-muted">vs prior {w.days}d</dt><dd className="tabular-nums">{pct(w.viewsChangePct, true)}</dd></div>
                    <div><dt className="text-muted">Engagement</dt><dd className="tabular-nums">{pct(w.engagement)}</dd></div>
                    <div><dt className="text-muted">Profile views</dt><dd className="tabular-nums">{fmt(w.profileViews, 0)}</dd></div>
                    <div><dt className="text-muted">Net followers</dt><dd className="tabular-nums">{fStart != null && fEnd != null ? (fEnd - fStart >= 0 ? `+${fEnd - fStart}` : fEnd - fStart) : 'Unavailable'}</dd></div>
                  </dl>
                </div>
              )
            })}
          </div>

          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted">Returning viewers (last 28 days)</dt>
              <dd className="tabular-nums">{tot ? pct((ret / tot) * 100) : 'Unavailable'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">
                Followers most active{tk.audience.activity && ` (${shortDate(tk.audience.activity.from)}–${shortDate(tk.audience.activity.to)})`}
              </dt>
              <dd>{hours.length ? hours.map((h) => hourLabel(h.hour)).join(', ') : 'Unavailable'}</dd>
              {hours.length > 0 && <dd className="text-xs text-faint">Hours as TikTok reports them</dd>}
            </div>
            <div>
              <dt className="text-xs text-muted">Top territories</dt>
              <dd>{tk.audience.territories?.items.filter((t) => t.label !== 'Others').slice(0, 3).map((t) => `${t.label} ${pct(t.share * 100)}`).join(' · ') ?? 'Unavailable'}</dd>
            </div>
          </dl>
        </>
      )}

      <h3 className="mt-6 mb-2 text-sm font-medium">Videos</h3>
      {tk.videos.length === 0 ? (
        <Empty title="No Content export yet" />
      ) : (
        <>
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-ink-600">
                  {['Posted', 'Video', 'Views', 'Likes', 'Comments', 'Shares', 'Engagement'].map((h) => (
                    <th key={h} className="px-5 py-2 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => (
                  <tr key={v.id} className="border-b border-ink-700 last:border-0">
                    <td className="px-5 py-2 text-xs whitespace-nowrap text-muted">{v.postedDate ?? '—'}</td>
                    <td className="max-w-sm px-5 py-2">
                      {v.url ? (
                        <a href={v.url} target="_blank" rel="noreferrer" className="line-clamp-1 hover:text-accent" title={v.title}>{v.title || v.url}</a>
                      ) : (
                        <span className="line-clamp-1" title={v.title}>{v.title}</span>
                      )}
                    </td>
                    <td className="px-5 py-2 tabular-nums">{fmt(v.views, 0)}</td>
                    <td className="px-5 py-2 tabular-nums">{fmt(v.likes, 0)}</td>
                    <td className="px-5 py-2 tabular-nums">{fmt(v.comments, 0)}</td>
                    <td className="px-5 py-2 tabular-nums">{fmt(v.shares, 0)}</td>
                    <td className="px-5 py-2 tabular-nums">{pct(v.views ? engagementPct(v.likes ?? 0, v.comments ?? 0, v.shares ?? 0, v.views) : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {tk.videos.length > 12 && (
              <Button size="sm" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${tk.videos.length}`}</Button>
            )}
            <p className="text-xs text-faint">
              Lifetime totals as of each video’s latest Content export{latestContent ? ` (newest ${shortDate(latestContent.exportedAt.slice(0, 10))})` : ''}. Content exports only list recent videos, so older rows stop updating.
            </p>
          </div>
        </>
      )}
    </Card>
  )
}
