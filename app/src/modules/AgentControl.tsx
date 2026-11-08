'use client'

import { ArrowRight, ChartNoAxesColumnIncreasing, Sparkles } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Badge, Button, Card, CardTitle, Checkbox, CopyButton, Empty, Field, Mono, PageHeader, Select, Textarea } from '../components/ui'
import { cx } from '../lib/cx'
import { nowStamp, parseDate } from '../lib/dates'
import { buildAgentPrompt } from '../lib/agentPrompt'
import { ownerName, useProfile } from '../lib/profile'
import { isOverdue, nextId } from '../lib/rules'
import { patch, upsert, useAppState, useToday } from '../lib/store'
import type { Handoff, Owner, Profile } from '../lib/types'

const ICONS = { analyst: <ChartNoAxesColumnIncreasing size={20} />, creative: <Sparkles size={20} /> }

const duties = (p: Profile) => ({
  analyst: [
    'Audit profiles and available analytics with authorized access',
    'Classify comments and draft replies in your voice',
    'Weekly “What my audience is telling us” report',
    'Maintain the scorecard and experiment log',
    `Prioritized engagement queue for ${p.creatorName}`,
  ],
  creative: [
    `Weekly calendar and creative briefs from ${p.agents.analyst.name}’s evidence`,
    'Three truthful hooks, scripts and shot ideas per TikTok',
    'Native X adaptations, not copied captions',
    'Propose creative tests and batch filming',
    `Hand ${p.agents.analyst.name} the planned post, audience, experiment and metric`,
  ],
})

const PIPELINE: [Owner, string][] = [
  ['analyst', 'Delivers evidence'],
  ['creative', 'Develops the brief'],
  ['creator', 'Approves and records'],
  ['creator', 'Publishes on the platform'],
  ['analyst', 'Measures results'],
]

const loop = (p: Profile) => [
  { days: [1], label: 'Monday', text: `${p.agents.analyst.name} reviews results and audience questions. ${p.agents.creative.name} proposes three priorities, the calendar, one experiment and needed assets. ${p.creatorName} selects and approves.` },
  { days: [2, 3, 4, 5], label: 'Tuesday–Friday', text: 'Create, record, approve, publish and engage as permitted. Log links and results.' },
  { days: [0, 6], label: 'Weekend', text: 'Report, review open leads and plan next week. Batch recording where helpful.' },
]

const handoffText = (h: Handoff, p: Profile) => `[${h.id}] ${ownerName(p, h.from)} → ${ownerName(p, h.to)} re ${h.itemId || 'general'}: ${h.message}`

export default function AgentControl() {
  const s = useAppState()
  const p = useProfile()
  const dow = parseDate(useToday()).getDay()
  const d = duties(p)
  return (
    <>
      <PageHeader eyebrow="Agent Control" title={`${p.agents.analyst.name} and ${p.agents.creative.name} operations`}>
        Agents are not connected to this dashboard. They do not run in the background, monitor accounts or act on their own. Copy a prompt into each agent and paste handoffs between them.
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        {(['analyst', 'creative'] as const).map((role) => (
          <Card key={role}>
            <CardTitle icon={ICONS[role]} right={<Badge>Not connected</Badge>}>{p.agents[role].name}</CardTitle>
            <p className="-mt-2 mb-4 text-sm text-muted">{p.agents[role].role}</p>
            <ul className="mb-4 flex flex-col gap-1.5 text-sm">
              {d[role].map((x) => (
                <li key={x} className="flex gap-2"><span className="text-accent">·</span>{x}</li>
              ))}
            </ul>
            <CopyButton text={buildAgentPrompt(s, role)} label={`Copy ${p.agents[role].name} system prompt`} size="md" />
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardTitle>Handoff chain</CardTitle>
        <ol className="flex flex-wrap items-center gap-2 text-sm">
          {PIPELINE.map(([who, what], i) => (
            <li key={what} className="flex items-center gap-2">
              <span className="rounded-lg border border-ink-600 bg-ink-900 px-3 py-2">
                <span className="block text-xs text-accent">{p.owner(who)}</span>
                {what}
              </span>
              {i < PIPELINE.length - 1 && <ArrowRight size={14} className="text-faint" aria-hidden />}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-faint">Neither agent sees the other’s updates. Every handoff names an item ID. {p.creatorName} resolves conflicts.</p>
      </Card>

      <Card className="mt-4">
        <CardTitle>Weekly loop</CardTitle>
        <div className="grid gap-3 md:grid-cols-3">
          {loop(p).map((l) => {
            const now = l.days.includes(dow)
            return (
              <div key={l.label} className={cx('rounded-xl border p-4', now ? 'border-accent/50 bg-accent/5' : 'border-ink-600')}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {l.label} {now && <Badge tone="accent">Today</Badge>}
                </div>
                <p className="mt-2 text-sm text-muted">{l.text}</p>
              </div>
            )
          })}
        </div>
      </Card>

      <PasteAnalystReply />
      <HandoffLog />
    </>
  )
}

/** Paste-in mode: the analyst's reply, copied from wherever it ran, is stored as a handoff naming an audit id. */
function PasteAnalystReply() {
  const s = useAppState()
  const p = useProfile()
  const [text, setText] = useState('')
  const itemId = `AUDIT-${useToday()}`
  return (
    <Card className="mt-4">
      <CardTitle>Paste {p.agents.analyst.name}'s reply</CardTitle>
      <p className="mb-3 text-sm text-muted">
        Stores the reply as a handoff from {p.agents.analyst.name} to {p.agents.creative.name} for <Mono>{itemId}</Mono>, so {p.agents.creative.name} reads it from the endpoint. Nothing is posted anywhere.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          upsert('handoffs', { id: nextId('H', s.handoffs), from: 'analyst', to: 'creative', itemId, type: 'analysis', message: text.trim(), createdAt: nowStamp(), acknowledged: false })
          setText('')
        }}
      >
        <Field label="Analyst reply">{(id) => <Textarea id={id} rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the full audit here" />}</Field>
        <Button type="submit" variant="primary" className="mt-3" disabled={!text.trim()}>Store as handoff</Button>
      </form>
    </Card>
  )
}

function HandoffLog() {
  const s = useAppState()
  const p = useProfile()
  const audit = `AUDIT-${useToday()}`
  const empty = { from: 'analyst' as Owner, to: 'creative' as Owner, itemId: '', message: '' }
  const [f, setF] = useState(empty)
  const OWNERS = p.owners
  const itemOptions: Record<string, string> = {
    '': 'Choose an item',
    ...Object.fromEntries(s.content.map((c) => [c.id, `${c.id} · ${c.title || 'Untitled'}`])),
    [audit]: `${audit} · daily audit`,
  }
  const sorted = [...s.handoffs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const open = sorted.filter((h) => !h.acknowledged)

  return (
    <Card className="mt-4">
      <CardTitle right={open.length > 0 && <CopyButton text={open.map((h) => handoffText(h, s.profile)).join('\n')} label="Copy open handoffs" />}>Handoff log</CardTitle>
      <form
        className="grid gap-3 sm:grid-cols-[7rem_7rem_1fr]"
        onSubmit={(e) => {
          e.preventDefault()
          if (!f.message.trim() || !f.itemId) return
          upsert('handoffs', { id: nextId('H', s.handoffs), ...f, message: f.message.trim(), createdAt: nowStamp(), acknowledged: false })
          setF(empty)
        }}
      >
        <Field label="From">{(id) => <Select id={id} options={OWNERS} value={f.from} onChange={(from) => setF({ ...f, from })} />}</Field>
        <Field label="To">{(id) => <Select id={id} options={OWNERS} value={f.to} onChange={(to) => setF({ ...f, to })} />}</Field>
        <Field label="Item ID">{(id) => <Select id={id} options={itemOptions} value={f.itemId} onChange={(itemId) => setF({ ...f, itemId })} />}</Field>
        <Field label="Concise handoff" className="sm:col-span-3">
          {(id) => <Textarea id={id} rows={2} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="What changed, what you need, by when" />}
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" variant="primary" disabled={!f.message.trim() || !f.itemId}>Log handoff</Button>
        </div>
      </form>
      <div className="mt-5">
        {sorted.length === 0 ? (
          <Empty title="No handoffs yet" />
        ) : (
          <ul className="flex flex-col divide-y divide-ink-700">
            {sorted.map((h) => (
              <li key={h.id} className="flex flex-wrap items-start gap-3 py-3 text-sm">
                {h.to === 'creator' ? (
                  <Checkbox checked={h.acknowledged} onChange={(acknowledged) => acknowledged && patch('handoffs', h.id, { acknowledged })} label={<Handoffline h={h} />} />
                ) : (
                  <Handoffline h={h} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function Handoffline({ h }: { h: Handoff }): ReactNode {
  const p = useProfile()
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2 text-xs">
        <Mono>{h.id}</Mono>
        <span>{p.owner(h.from)} → {p.owner(h.to)}</span>
        {h.itemId && <Badge tone="accent">{h.itemId}</Badge>}
        {h.type && h.type !== 'question' && <Badge>{h.type}</Badge>}
        {isOverdue(h) && <Badge tone="warn">Unread 24h+</Badge>}
        {h._meta && <span className="text-faint">by {h._meta.createdBy}</span>}
      </span>
      <span className="whitespace-pre-wrap">{h.message}</span>
    </span>
  )
}
