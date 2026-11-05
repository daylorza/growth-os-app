import { Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardTitle, CopyButton, Empty, Field, Input, Mono, PageHeader, Select, Textarea } from '../components/ui'
import { addDays, today, weekRange } from '../lib/dates'
import { EXPERIMENT_STATUS, PILLARS, PLATFORM, UNKNOWN } from '../lib/labels'
import { fmt, per1k, periodChange, pillarMix } from '../lib/metrics'
import { nextId } from '../lib/rules'
import { patch, remove, upsert, useAppState } from '../lib/store'
import { useFollowerSnapshots } from '../lib/tiktokData'
import type { AppState, AudienceReport, Experiment, FollowerSnapshot, Platform } from '../lib/types'

const EXP_FIELDS: [keyof Experiment, string, boolean?][] = [
  ['hypothesis', 'Hypothesis', true],
  ['change', 'One main change'],
  ['audiencePillar', 'Audience / pillar'],
  ['posts', 'Posts and dates'],
  ['primaryMetric', 'Primary metric'],
  ['baseline', 'Comparison / baseline'],
  ['window', 'Observation window'],
  ['result', 'Result', true],
  ['confidence', 'Confidence and limitations', true],
  ['nextAction', 'Next action'],
]

const REPORT_FIELDS: [keyof AudienceReport, string][] = [
  ['repeatedQuestions', 'Repeated questions'],
  ['evidence', 'Evidence (links, comment IDs)'],
  ['objections', 'Objections'],
  ['requestedTopics', 'Requested topics'],
  ['businessSignals', 'Business signals'],
  ['opportunities', 'Three content opportunities'],
  ['limitations', 'Uncertainty and sample limits'],
]

function weeklyReport(s: AppState, snaps: FollowerSnapshot[], on: string = today()) {
  const { start, end } = weekRange(on)
  const lines: string[] = [`# Weekly report · ${start} to ${end}`, '']
  // Baseline = latest TikTok count on or before the campaign start, else the earliest one recorded.
  const tt = snaps.filter((x) => x.platform === 'tiktok').sort((a, b) => a.date.localeCompare(b.date))
  const baseline = tt.filter((x) => x.date <= s.settings.campaignStart).at(-1) ?? tt[0]
  lines.push(`**Baseline:** ${baseline ? `${baseline.count} TikTok followers on ${baseline.date} (${baseline.verified ? 'verified' : 'unverified'})` : UNKNOWN}`)

  const thisWeek = s.content.filter((c) => c.plannedDate >= start && c.plannedDate <= end)
  const published = s.content.filter((c) => c.status === 'published' && c.publishedAt >= start && c.publishedAt <= end)
  lines.push(`**Publishing vs plan:** ${published.length} published of ${thisWeek.length} planned (TikTok target ${s.settings.weeklyTikTokTarget})`)

  for (const p of ['tiktok', 'x'] as Platform[]) {
    const ch = periodChange(snaps, p, addDays(start, -1), end)
    lines.push(`**${PLATFORM[p]} followers:** ${ch ? `${ch.start.count} → ${ch.end.count} (net ${ch.net}, ${fmt(ch.pct)}%)${ch.verified ? '' : ' · includes unverified data'}` : 'Unavailable: needs two snapshots this week'}`)
  }

  for (const p of ['tiktok', 'x'] as Platform[]) {
    const ranked = published
      .filter((c) => c.platform === p && per1k(c.metrics.shares, c.metrics.views) != null)
      .sort((a, b) => per1k(b.metrics.shares, b.metrics.views)! - per1k(a.metrics.shares, a.metrics.views)!)
    if (ranked.length >= 2) {
      const [best, worst] = [ranked[0], ranked.at(-1)!]
      lines.push(`**${PLATFORM[p]} best / weakest (shares per 1k):** ${best.id} ${fmt(per1k(best.metrics.shares, best.metrics.views))} · ${worst.id} ${fmt(per1k(worst.metrics.shares, worst.metrics.views))}`)
    } else lines.push(`**${PLATFORM[p]} best / weakest:** Unavailable: fewer than two comparable posts with metrics`)
  }

  const report = [...s.reports].sort((a, b) => b.weekOf.localeCompare(a.weekOf))[0]
  lines.push(`**Audience questions:** ${report?.repeatedQuestions || UNKNOWN}`)
  const leads = s.leads.filter((l) => l.createdAt >= start && l.createdAt <= end)
  lines.push(`**Qualified leads this week:** ${leads.length}`)
  const exp = s.experiments.find((x) => x.status === 'running') ?? s.experiments.find((x) => x.status === 'planned')
  lines.push(`**Experiment:** ${exp ? `${exp.id} · ${exp.hypothesis} · limitations: ${exp.confidence || UNKNOWN}` : 'None running'}`)
  lines.push('', '**Three actions (owner, deadline):**', '1. ', '2. ', '3. ', '', '_Missing data is labelled. No numbers are estimated._')
  return lines.join('\n')
}

export default function ContentIntelligence() {
  const s = useAppState()
  const snaps = useFollowerSnapshots()
  const report = weeklyReport(s, snaps)
  const mix = pillarMix(s.content)
  const total = mix.reduce((n, m) => n + m.count, 0)
  return (
    <>
      <PageHeader eyebrow="Content Intelligence" title="Experiments, trends and insights">
        Change one main variable at a time. Small samples and delayed distribution are limitations, not conclusions.
      </PageHeader>

      <Card>
        <CardTitle right={<span className="text-xs text-muted">{total} items counted</span>}>Content mix vs starting hypothesis</CardTitle>
        <div className="flex flex-col gap-3">
          {mix.map((m) => (
            <div key={m.pillar} className="grid grid-cols-[minmax(0,12rem)_1fr_5rem] items-center gap-3 text-sm">
              <span className="truncate" title={PILLARS[m.pillar].note}>{PILLARS[m.pillar].label}</span>
              <div className="relative h-2 rounded-full bg-ink-600">
                <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${m.actual}%` }} />
                <div className="absolute -inset-y-1 w-0.5 bg-fg/70" style={{ left: `${m.target}%` }} title={`Target ${m.target}%`} />
              </div>
              <span className="text-right text-xs tabular-nums text-muted">{Math.round(m.actual)}% / {m.target}%</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-faint">White tick = starting target. Ratios are hypotheses to adjust on evidence.</p>
      </Card>

      <Card className="mt-4">
        <CardTitle
          right={
            <Button size="sm" onClick={() => upsert('experiments', { id: nextId('X', s.experiments), hypothesis: '', change: '', audiencePillar: '', posts: '', primaryMetric: '', baseline: '', window: '', result: '', confidence: '', nextAction: '', status: 'planned' })}>
              <Plus size={14} /> New experiment
            </Button>
          }
        >
          Experiment log
        </CardTitle>
        {s.experiments.length === 0 ? (
          <Empty title="No experiments yet">Start with one hook or format change.</Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {s.experiments.map((x) => (
              <details key={x.id} className="rounded-xl border border-ink-600 bg-ink-900">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm">
                  <Mono>{x.id}</Mono>
                  <span className="min-w-0 flex-1 truncate">{x.hypothesis || 'Untitled hypothesis'}</span>
                  {x.demo && <Badge>Demo</Badge>}
                  <Badge tone={x.status === 'running' ? 'accent' : x.status === 'done' ? 'ok' : 'neutral'}>{EXPERIMENT_STATUS[x.status]}</Badge>
                </summary>
                <div className="grid gap-3 border-t border-ink-600 p-4 sm:grid-cols-2">
                  {EXP_FIELDS.map(([k, label, wide]) => (
                    <Field key={k} label={label} className={wide ? 'sm:col-span-2' : undefined}>
                      {(id) => <Textarea id={id} rows={wide ? 2 : 1} value={String(x[k] ?? '')} onChange={(e) => patch('experiments', x.id, { [k]: e.target.value })} />}
                    </Field>
                  ))}
                  <Field label="Status">{(id) => <Select id={id} options={EXPERIMENT_STATUS} value={x.status} onChange={(status) => patch('experiments', x.id, { status })} />}</Field>
                  <div className="flex items-end justify-end">
                    <Button size="sm" variant="ghost" onClick={() => confirm(`Delete ${x.id}?`) && remove('experiments', x.id)}><Trash2 size={14} /> Delete</Button>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardTitle
          right={
            <Button size="sm" onClick={() => upsert('reports', { id: nextId('R', s.reports), weekOf: weekRange().start, repeatedQuestions: '', evidence: '', objections: '', requestedTopics: '', businessSignals: '', opportunities: '', limitations: '' })}>
              <Plus size={14} /> New weekly report
            </Button>
          }
        >
          What my audience is telling us
        </CardTitle>
        {s.reports.length === 0 ? (
          <Empty title="No audience report yet">{s.profile.agents.analyst.name} fills this in weekly from real comments and mentions.</Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {[...s.reports].sort((a, b) => b.weekOf.localeCompare(a.weekOf)).map((r) => (
              <details key={r.id} className="rounded-xl border border-ink-600 bg-ink-900" open={r === s.reports.at(-1)}>
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm">
                  <Mono>{r.id}</Mono> Week of {r.weekOf}
                </summary>
                <div className="grid gap-3 border-t border-ink-600 p-4 sm:grid-cols-2">
                  <Field label="Week of">{(id) => <Input id={id} type="date" value={r.weekOf} onChange={(e) => patch('reports', r.id, { weekOf: e.target.value })} />}</Field>
                  <div />
                  {REPORT_FIELDS.map(([k, label]) => (
                    <Field key={k} label={label}>
                      {(id) => <Textarea id={id} value={String(r[k] ?? '')} onChange={(e) => patch('reports', r.id, { [k]: e.target.value })} />}
                    </Field>
                  ))}
                  <div className="flex items-end justify-end sm:col-span-2">
                    <Button size="sm" variant="ghost" onClick={() => confirm(`Delete ${r.id}?`) && remove('reports', r.id)}><Trash2 size={14} /> Delete</Button>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardTitle right={<CopyButton text={report} label="Copy report" />}>Weekly report draft</CardTitle>
        <pre className="overflow-x-auto rounded-xl bg-ink-900 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted">{report}</pre>
      </Card>
    </>
  )
}
