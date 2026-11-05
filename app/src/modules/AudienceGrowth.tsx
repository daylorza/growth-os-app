import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, CardTitle, Checkbox, Empty, Field, Input, Mono, PageHeader, Select } from '../components/ui'
import { addDays, shortDate, today } from '../lib/dates'
import { PLATFORM } from '../lib/labels'
import { fmt, latestSnapshot, per1k, periodChange, profileToFollow, sortedSnapshots } from '../lib/metrics'
import { nextId } from '../lib/rules'
import { remove, upsert, useAppState } from '../lib/store'
import { useFollowerSnapshots, useTikTok } from '../lib/tiktokData'
import TikTokStudio from './TikTokStudio'
import type { FollowerSnapshot, Platform } from '../lib/types'

const PERIODS = { '7': 'Last 7 days', '30': 'Last 30 days', campaign: 'Since campaign start' } as const
type Period = keyof typeof PERIODS

export default function AudienceGrowth() {
  const s = useAppState()
  const tk = useTikTok()
  const snaps = useFollowerSnapshots()
  const [period, setPeriod] = useState<Period>('7')
  const to = today()
  const from = period === 'campaign' ? s.settings.campaignStart : addDays(to, -Number(period))
  const published = s.content.filter((c) => c.status === 'published')

  return (
    <>
      <PageHeader
        eyebrow="Audience Growth"
        title="TikTok and X performance"
        right={
          <Select aria-label="Reporting period" options={PERIODS} value={period} onChange={setPeriod} className="w-auto!" />
        }
      >
        Numbers come only from TikTok Studio exports and snapshots you record. TikTok and X are tracked separately and never added together.
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        {(['tiktok', 'x'] as Platform[]).map((p) => (
          <PlatformPanel key={p} platform={p} snaps={snaps} from={from} to={to} />
        ))}
      </div>

      <TikTokStudio tk={tk} />

      <SnapshotForm snaps={s.snapshots} />

      <Card className="mt-4">
        <CardTitle>Post performance</CardTitle>
        {published.length === 0 ? (
          <Empty title="No published posts logged yet">
            Log a post as published in <a className="text-accent" href="#/studio">Content Studio</a>, then add its metrics there.
          </Empty>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-ink-600">
                  {['ID', 'Post', 'Platform', 'Age (h)', 'Views / impr.', 'Shares / 1k', 'Follows / 1k', 'Profile → follow', 'Source'].map((h) => (
                    <th key={h} className="px-5 py-2 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {published.map((c) => {
                  const m = c.metrics
                  return (
                    <tr key={c.id} className="border-b border-ink-700 last:border-0">
                      <td className="px-5 py-2"><Mono>{c.id}</Mono></td>
                      <td className="px-5 py-2">
                        {c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="hover:text-accent">{c.title || 'Untitled'}</a> : c.title}
                      </td>
                      <td className="px-5 py-2">{PLATFORM[c.platform]}</td>
                      <td className="px-5 py-2 tabular-nums">{fmt(m.ageHours, 0)}</td>
                      <td className="px-5 py-2 tabular-nums">{fmt(m.views, 0)}</td>
                      <td className="px-5 py-2 tabular-nums">{fmt(per1k(m.shares, m.views))}</td>
                      <td className="px-5 py-2 tabular-nums">{fmt(per1k(m.follows, m.views))}</td>
                      <td className="px-5 py-2 tabular-nums">
                        {m.sameCohort ? `${fmt(profileToFollow(m.follows, m.profileVisits, true))}%` : 'Unavailable'}
                      </td>
                      <td className="px-5 py-2 text-xs text-muted">{m.source || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs text-faint">
          Compare similar formats at similar ages against your own baseline. One viral post is a clue, not proof.
        </p>
      </Card>
    </>
  )
}

function PlatformPanel({ platform, snaps, from, to }: { platform: Platform; snaps: FollowerSnapshot[]; from: string; to: string }) {
  const latest = latestSnapshot(snaps, platform)
  const change = periodChange(snaps, platform, from, to)
  const series = sortedSnapshots(snaps, platform)
  return (
    <Card>
      <div className="flex items-start justify-between">
        <h2 className="text-sm text-muted">{PLATFORM[platform]} followers</h2>
        {latest && <Badge tone={latest.verified ? 'ok' : 'warn'}>{latest.verified ? 'Verified' : 'Unverified'}</Badge>}
      </div>
      <div className="mt-3 text-4xl font-semibold tabular-nums">{latest ? latest.count.toLocaleString() : 'UNKNOWN'}</div>
      <p className="mt-1 text-xs text-faint">{latest ? `As of ${shortDate(latest.date)} · ${latest.source}` : 'No snapshot recorded'}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-ink-600 pt-4 text-sm">
        <div>
          <dt className="text-xs text-muted">Net followers</dt>
          <dd className="tabular-nums">{change ? (change.net >= 0 ? `+${change.net}` : change.net) : 'Unavailable'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Growth</dt>
          <dd className="tabular-nums">{change?.pct != null ? `${fmt(change.pct)}%` : 'Unavailable'}</dd>
        </div>
      </dl>
      {!change && <p className="mt-2 text-xs text-faint">Needs two snapshots inside this period.</p>}
      {change && !change.verified && <p className="mt-2 text-xs text-warn">Includes unverified snapshots.</p>}
      <Sparkline points={series.map((x) => x.count)} />
    </Card>
  )
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null
  const w = 300
  const h = 48
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const d = points
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 h-12 w-full" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function SnapshotForm({ snaps }: { snaps: FollowerSnapshot[] }) {
  const empty = { platform: 'tiktok' as Platform, date: today(), count: '', source: '', verified: false }
  const [f, setF] = useState(empty)
  const valid = f.count !== '' && Number(f.count) >= 0 && f.source.trim()
  const sorted = [...snaps].sort((a, b) => b.date.localeCompare(a.date))
  return (
    <Card className="mt-4">
      <CardTitle>Manual follower snapshots</CardTitle>
      <p className="-mt-2 mb-4 text-sm text-muted">TikTok follower history comes from exports automatically. Record X, or anything an export doesn't cover, here.</p>
      <form
        className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[8rem_10rem_8rem_1fr_auto_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          upsert('snapshots', { id: nextId('S', snaps), platform: f.platform, date: f.date, count: Number(f.count), source: f.source.trim(), verified: f.verified })
          setF(empty)
        }}
      >
        <Field label="Platform">{(id) => <Select id={id} options={PLATFORM} value={f.platform} onChange={(platform) => setF({ ...f, platform })} />}</Field>
        <Field label="Date">{(id) => <Input id={id} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="Followers">{(id) => <Input id={id} type="number" min={0} value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} />}</Field>
        <Field label="Source">{(id) => <Input id={id} placeholder="e.g. TikTok analytics screenshot" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />}</Field>
        <div className="pb-2"><Checkbox checked={f.verified} onChange={(verified) => setF({ ...f, verified })} label="Verified" strike={false} /></div>
        <Button type="submit" variant="primary" disabled={!valid}>Record</Button>
      </form>
      {sorted.length > 0 && (
        <ul className="mt-5 divide-y divide-ink-700 text-sm">
          {sorted.map((x) => (
            <li key={x.id} className="flex items-center gap-3 py-2">
              <Mono>{x.date}</Mono>
              <span className="w-14">{PLATFORM[x.platform]}</span>
              <span className="w-16 tabular-nums">{x.count.toLocaleString()}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{x.source}</span>
              {x.demo && <Badge>Demo</Badge>}
              <Badge tone={x.verified ? 'ok' : 'warn'}>{x.verified ? 'Verified' : 'Unverified'}</Badge>
              <Button variant="ghost" size="sm" aria-label="Delete snapshot" onClick={() => confirm('Delete this snapshot?') && remove('snapshots', x.id)}>
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
