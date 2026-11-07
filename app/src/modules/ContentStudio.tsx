'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Card, CardTitle, ConfirmButton, CopyButton, Drawer, Empty, Field, Input, Mono, Notice, PageHeader, Select, Textarea } from '../components/ui'
import { cx } from '../lib/cx'
import { addDays, parseDate, shortDate, today, weekRange } from '../lib/dates'
import { CONTENT_STATUS, MODES, PILLARS, PLATFORM } from '../lib/labels'
import { useProfile } from '../lib/profile'
import { nextId, publishLogError, scheduleError } from '../lib/rules'
import { blankContent } from '../lib/seed'
import { patch, remove, upsert, useAppState } from '../lib/store'
import type { ContentItem, ContentStatus, PostMetrics, Profile } from '../lib/types'
import { ownerName } from '../lib/profile'

const statusTone: Record<ContentStatus, 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'> = {
  idea: 'neutral',
  draft: 'neutral',
  needs_review: 'warn',
  approved: 'accent',
  scheduled: 'accent',
  published: 'ok',
  failed: 'danger',
  killed: 'danger',
}


function briefMarkdown(c: ContentItem, p: Profile) {
  return [
    `## ${c.id} · ${c.title || 'Untitled'}`,
    `${PLATFORM[c.platform]} · ${c.plannedDate} · ${PILLARS[c.pillar].label} · ${MODES[c.mode].label} · Owner: ${ownerName(p, c.owner)}`,
    `Status: ${CONTENT_STATUS[c.status]} · Approval: ${c.approval}`,
    '',
    `**Objective:** ${c.objective}`,
    `**Audience:** ${c.audience}`,
    `**Hooks**\n- Curiosity: ${c.hookCuriosity}\n- Opinion: ${c.hookOpinion}\n- Outcome/demo: ${c.hookOutcome}`,
    `**Talking points / script**\n${c.talkingPoints}`,
    `**Visuals:** ${c.visuals}`,
    `**Caption:** ${c.caption}`,
    `**Hashtags:** ${c.hashtags}`,
    `**CTA:** ${c.cta}`,
    `**X adaptation:** ${c.xAdaptation}`,
    `**Claims / sources:** ${c.claimSource}`,
    c.experimentId && `**Experiment:** ${c.experimentId}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export default function ContentStudio() {
  const s = useAppState()
  const p = useProfile()
  const [view, setView] = useState<'calendar' | 'list'>('calendar')
  const [openId, setOpenId] = useState<string | null>(null)
  const open = s.content.find((c) => c.id === openId) ?? null

  const create = (date: string) => {
    const id = nextId('C', s.content)
    upsert('content', blankContent(id, date))
    setOpenId(id)
  }

  const start = s.settings.campaignStart
  const gridStart = weekRange(start).start
  const days = Array.from({ length: 35 }, (_, i) => addDays(gridStart, i))
  const campaignEnd = addDays(start, 29)
  const batch = s.content.filter((c) => c.platform === 'tiktok' && c.approval === 'approved' && c.status !== 'published')

  return (
    <>
      <PageHeader
        eyebrow="Content Studio"
        title="30-day calendar and scripts"
        right={
          <>
            <div className="flex rounded-lg border border-ink-600 p-0.5 text-sm">
              {(['calendar', 'list'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={cx('rounded-md px-3 py-1.5 capitalize', view === v ? 'bg-ink-700 text-fg' : 'text-muted hover:text-fg')}>
                  {v}
                </button>
              ))}
            </div>
            <Button variant="primary" onClick={() => create(today())}>
              <Plus size={16} /> New brief
            </Button>
          </>
        }
      >
        {p.agents.creative.name} drafts, {p.creatorName} approves. Publishing happens on the platform, by you. Log the live link here afterwards.
      </PageHeader>

      {view === 'calendar' ? (
        <Card className="p-3 sm:p-5">
          <p className="mb-2 text-xs text-muted md:hidden">Scroll sideways to see the full week.</p>
          <div className="overflow-x-auto" role="region" aria-label="Content calendar, scroll horizontally to see the full week" tabIndex={0}>
            <div className="min-w-[42rem]">
              <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <div key={d} className="pb-2">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {days.map((d) => {
                  const inCampaign = d >= start && d <= campaignEnd
                  const items = s.content.filter((c) => c.plannedDate === d)
                  return (
                    <div
                      key={d}
                      className={cx(
                        'group flex min-h-24 flex-col gap-1 rounded-lg border p-1.5 text-left',
                        inCampaign ? 'bg-ink-900' : 'bg-ink-800',
                        d === today() ? 'border-accent/60' : inCampaign ? 'border-ink-600' : 'border-transparent',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs tabular-nums text-muted">{parseDate(d).getDate()}</span>
                        <button
                          aria-label={`New brief on ${d}`}
                          onClick={() => create(d)}
                          className="rounded text-faint hover:text-accent"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      {items.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setOpenId(c.id)}
                          className={cx(
                            'truncate rounded px-1.5 py-1 text-left text-xs leading-tight',
                            c.status === 'published' ? 'bg-ok/10 text-ok' : c.approval === 'approved' ? 'bg-accent/15 text-accent' : 'bg-ink-700',
                          )}
                          title={`${c.id} · ${c.title}`}
                        >
                          <span className="font-mono opacity-70">{PLATFORM[c.platform]}</span> {c.title || 'Untitled'}
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          {s.content.length === 0 ? (
            <Empty title="No briefs yet">Start with a {p.projectName || 'project'} demo, an agent lesson and a founder story.</Empty>
          ) : (
            <ul className="divide-y divide-ink-700">
              {[...s.content]
                .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate))
                .map((c) => (
                  <li key={c.id}>
                    <button onClick={() => setOpenId(c.id)} className="flex w-full flex-wrap items-center gap-3 py-3 text-left hover:text-accent">
                      <Mono>{c.id}</Mono>
                      <span className="w-16 text-xs text-muted">{shortDate(c.plannedDate)}</span>
                      <span className="w-12 text-xs">{PLATFORM[c.platform]}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{c.title || 'Untitled'}</span>
                      <span className="text-xs text-muted">{PILLARS[c.pillar].label}</span>
                      <Badge tone={statusTone[c.status]}>{CONTENT_STATUS[c.status]}</Badge>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="mt-4">
        <CardTitle>Film in one batch</CardTitle>
        {batch.length === 0 ? (
          <p className="text-sm text-muted">Approved TikToks waiting to be recorded show up here.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {batch.map((c) => (
              <li key={c.id} className="flex items-center gap-3">
                <Mono>{c.id}</Mono>
                <button className="min-w-0 flex-1 truncate text-left hover:text-accent" onClick={() => setOpenId(c.id)}>{c.title}</button>
                <span className="text-xs text-muted">{c.visuals.slice(0, 60)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {open && <Editor item={open} onClose={() => setOpenId(null)} />}
    </>
  )
}

const BRIEF_KEYS: (keyof ContentItem)[] = [
  'title', 'platform', 'pillar', 'format', 'mode', 'objective', 'audience', 'hookCuriosity', 'hookOpinion', 'hookOutcome',
  'talkingPoints', 'visuals', 'caption', 'hashtags', 'cta', 'xAdaptation', 'claimSource',
]

function Editor({ item: c, onClose }: { item: ContentItem; onClose: () => void }) {
  const s = useAppState()
  const p = useProfile()
  const who = p.creatorName
  const [error, setError] = useState<string | null>(null)
  const [publishDate, setPublishDate] = useState(c.publishedAt || today())
  // The live URL stays a local draft until a log succeeds, so a blocked attempt saves nothing.
  const [urlDraft, setUrlDraft] = useState(c.url)
  const [blockedClicks, setBlockedClicks] = useState(0)
  const blockRef = useRef<HTMLParagraphElement>(null)
  // Recomputed every render: stays visible until the missing condition is fixed, then clears itself.
  const publishBlock = blockedClicks > 0 && c.status !== 'published' ? publishLogError({ approval: c.approval, url: urlDraft }, who) : null
  useEffect(() => {
    if (blockedClicks) blockRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [blockedClicks])
  const logPublished = () => {
    if (publishLogError({ approval: c.approval, url: urlDraft }, who)) return setBlockedClicks((n) => n + 1)
    set({ status: 'published', publishedAt: publishDate, url: urlDraft.trim() })
    setBlockedClicks(0)
  }

  const set = (changes: Partial<ContentItem>) => {
    const touchesBrief = Object.keys(changes).some((k) => BRIEF_KEYS.includes(k as keyof ContentItem))
    const reopen = touchesBrief && c.approval === 'approved' && c.status !== 'published'
    patch('content', c.id, reopen ? { ...changes, approval: 'pending', status: 'needs_review' } : changes)
    setError(null)
  }
  const setMetric = (k: keyof PostMetrics, v: string | boolean) =>
    set({ metrics: { ...c.metrics, [k]: typeof v === 'boolean' ? v : v === '' ? undefined : k === 'source' || k === 'measuredAt' ? v : Number(v) } })

  const guarded = (err: string | null, changes: Partial<ContentItem>) => (err ? setError(err) : set(changes))
  const projectPattern = p.projectName.trim() ? new RegExp(p.projectName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'i') : null
  const mentionsProject = !!projectPattern?.test(BRIEF_KEYS.map((k) => String(c[k])).join(' '))
  const text = (k: keyof ContentItem, label: string, rows = 2, hint?: string) => (
    <Field label={label} hint={hint}>
      {(id) => <Textarea id={id} rows={rows} value={String(c[k] ?? '')} onChange={(e) => set({ [k]: e.target.value })} />}
    </Field>
  )

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          <Mono>{c.id}</Mono>
          <Badge tone={statusTone[c.status]}>{CONTENT_STATUS[c.status]}</Badge>
          <Badge tone={c.approval === 'approved' ? 'ok' : c.approval === 'changes_requested' ? 'warn' : 'neutral'}>
            {c.approval === 'approved' ? `Approved by ${who}` : c.approval === 'changes_requested' ? 'Changes requested' : 'Awaiting approval'}
          </Badge>
        </span>
      }
      footer={
        <>
          {c.status !== 'published' && c.approval !== 'approved' && (
            <>
              <Button onClick={() => set({ status: 'needs_review' })}>Send to {who} for review</Button>
              <Button variant="primary" onClick={() => set({ approval: 'approved', status: 'approved' })}>Approve ({who})</Button>
              <Button variant="ghost" onClick={() => set({ approval: 'changes_requested', status: 'draft' })}>Request changes</Button>
            </>
          )}
          {c.approval === 'approved' && c.status !== 'published' && (
            <Button onClick={() => guarded(scheduleError(c, who), { status: 'scheduled' })}>Mark scheduled by {who}</Button>
          )}
          <CopyButton text={briefMarkdown(c, s.profile)} label="Copy brief" size="md" />
          <ConfirmButton
            variant="danger"
            className="ml-auto"
            message={`Delete ${c.id}? This cannot be undone.`}
            onConfirm={() => { remove('content', c.id); onClose() }}
          >
            <Trash2 size={14} /> Delete
          </ConfirmButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Notice tone="danger">{error}</Notice>}
        {c.approval === 'approved' && c.status !== 'published' && (
          <Notice tone="accent">Approved. Editing the brief sends it back to {who} for review.</Notice>
        )}
        <Field label="Working title">{(id) => <Input id={id} value={c.title} onChange={(e) => set({ title: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Platform">{(id) => <Select id={id} options={PLATFORM} value={c.platform} onChange={(platform) => set({ platform })} />}</Field>
          <Field label="Planned date">{(id) => <Input id={id} type="date" value={c.plannedDate} onChange={(e) => set({ plannedDate: e.target.value })} />}</Field>
          <Field label="Owner">{(id) => <Select id={id} options={p.owners} value={c.owner} onChange={(owner) => set({ owner })} />}</Field>
          <Field label="Pillar">
            {(id) => <Select id={id} options={Object.fromEntries(Object.entries(PILLARS).map(([k, v]) => [k, v.label])) as Record<ContentItem['pillar'], string>} value={c.pillar} onChange={(pillar) => set({ pillar })} />}
          </Field>
          <Field label="Format">{(id) => <Input id={id} value={c.format} onChange={(e) => set({ format: e.target.value })} />}</Field>
          <Field label="Mode">
            {(id) => <Select id={id} options={Object.fromEntries(Object.entries(MODES).map(([k, v]) => [k, v.label])) as Record<ContentItem['mode'], string>} value={c.mode} onChange={(mode) => set({ mode })} />}
          </Field>
        </div>
        <p className="-mt-2 text-xs text-faint">{MODES[c.mode].structure}</p>

        {text('objective', 'Objective')}
        {text('audience', 'Intended audience', 1)}
        <fieldset className="grid gap-3 rounded-xl border border-ink-600 p-4">
          <legend className="px-1 text-xs text-muted">Three truthful hooks</legend>
          {text('hookCuriosity', 'Curiosity', 1)}
          {text('hookOpinion', 'Considered opinion', 1)}
          {text('hookOutcome', 'Outcome / demo', 1)}
        </fieldset>
        {text('talkingPoints', c.mode === 'spontaneous' ? 'Talking points (leave room to improvise)' : 'Script', 5)}
        {text('visuals', 'Visual and shot suggestions')}
        {text('caption', 'Caption')}
        <div className="grid gap-3 sm:grid-cols-2">
          {text('hashtags', 'Hashtags (a few, relevant)', 1)}
          {text('cta', 'One CTA', 1)}
        </div>
        {text('xAdaptation', 'Native X adaptation (not a copied caption)', 3)}
        {text('claimSource', 'Claims and sources', 2, 'List every factual claim and where it was verified.')}
        {mentionsProject && !c.claimSource.trim() && (
          <Notice>Mentions {p.projectName}. Verify the event name, capabilities and dates. Do not imply a prize was won.</Notice>
        )}
        <Field label="Linked experiment">
          {(id) => (
            <Select
              id={id}
              options={{ '': 'None', ...Object.fromEntries(s.experiments.map((x) => [x.id, `${x.id} · ${x.hypothesis.slice(0, 50)}`])) }}
              value={c.experimentId}
              onChange={(experimentId) => set({ experimentId })}
            />
          )}
        </Field>

        <fieldset className="grid gap-3 rounded-xl border border-ink-600 p-4">
          <legend className="px-1 text-xs text-muted">Log as published (after you post it yourself)</legend>
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <Field label="Live post URL">{(id) => <Input id={id} type="url" placeholder="https://" value={urlDraft} readOnly={c.status === 'published'} onChange={(e) => setUrlDraft(e.target.value)} />}</Field>
            <Field label="Published on">{(id) => <Input id={id} type="date" value={publishDate} onChange={(e) => setPublishDate(e.target.value)} />}</Field>
          </div>
          <div className="flex gap-2">
            {c.status !== 'published' ? (
              <>
                <Button variant="primary" onClick={logPublished} aria-describedby={publishBlock ? `${c.id}-publish-block` : undefined}>Log as published</Button>
                {c.approval === 'approved' && <Button variant="ghost" onClick={() => set({ status: 'failed' })}>Mark failed</Button>}
              </>
            ) : (
              <Button variant="ghost" onClick={() => set({ status: 'approved', publishedAt: '' })}>Undo published log</Button>
            )}
          </div>
          {publishBlock && (
            <p ref={blockRef} id={`${c.id}-publish-block`} role="alert" data-testid="publish-block" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {publishBlock}
            </p>
          )}
        </fieldset>

        {c.status === 'published' && (
          <fieldset className="grid gap-3 rounded-xl border border-ink-600 p-4">
            <legend className="px-1 text-xs text-muted">Metrics (only what the platform shows you)</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ['views', c.platform === 'x' ? 'Impressions' : 'Views'],
                  ['avgWatchSec', 'Avg watch (s)'],
                  ['completionPct', 'Completion %'],
                  ['shares', 'Shares'],
                  ['saves', 'Saves'],
                  ['comments', 'Comments'],
                  ['profileVisits', 'Profile visits'],
                  ['follows', 'Attributed follows'],
                  ['ageHours', 'Post age (h)'],
                ] as [keyof PostMetrics, string][]
              ).map(([k, label]) => (
                <Field key={k} label={label}>
                  {(id) => <Input id={id} type="number" min={0} value={String(c.metrics[k] ?? '')} onChange={(e) => setMetric(k, e.target.value)} />}
                </Field>
              ))}
              <Field label="Measured on">{(id) => <Input id={id} type="date" value={c.metrics.measuredAt ?? ''} onChange={(e) => setMetric('measuredAt', e.target.value)} />}</Field>
            </div>
            <Field label="Data source">{(id) => <Input id={id} placeholder="e.g. TikTok Studio, screenshot" value={c.metrics.source ?? ''} onChange={(e) => setMetric('source', e.target.value)} />}</Field>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={!!c.metrics.sameCohort} onChange={(e) => setMetric('sameCohort', e.target.checked)} />
              Follows and profile visits describe the same cohort and period
            </label>
          </fieldset>
        )}
      </div>
    </Drawer>
  )
}
