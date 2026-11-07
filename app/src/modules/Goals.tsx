'use client'

import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, CardTitle, Checkbox, Field, Input, Mono, PageHeader, ProgressBar, Select, Textarea } from '../components/ui'
import { cx } from '../lib/cx'
import { campaignPosition, shortDate, today } from '../lib/dates'
import { latestSnapshot, milestoneProgress } from '../lib/metrics'
import { nextId } from '../lib/rules'
import { patch, remove, update, upsert, useAppState } from '../lib/store'
import { useFollowerSnapshots } from '../lib/tiktokData'
import { useProfile } from '../lib/profile'
import type { CheckIn, Owner, Task } from '../lib/types'

const PLAN = [
  { id: 'p1', days: [1, 3], label: 'Days 1–3 · Set up', items: ['Confirm handles, access, capacity, offers and claims', 'Audit available profiles and recent content', 'Record the baseline', 'Draft bios and first-week briefs for approval'] },
  { id: 'p2', days: [4, 7], label: 'Days 4–7 · Launch', items: ['Publish a verified project demo', 'Publish an agent lesson', 'Publish a founder story', 'Start the engagement queue', 'Log the first experiment'] },
  { id: 'p3', days: [8, 14], label: 'Days 8–14 · Learn', items: ['Review comparable posts', 'Turn a recurring question into a follow-up', 'Test one hook or format change', 'Adjust cadence to capacity'] },
  { id: 'p4', days: [15, 21], label: 'Days 15–21 · Deepen', items: ['Repeat a promising format with a new topic', 'Demonstrate a business workflow', 'Flag relevant leads or collaborators for review'] },
  { id: 'p5', days: [22, 30], label: 'Days 22–30 · Refine', items: ['Compare against baseline and goals', 'Decide what to repeat, change or stop', 'Draft the next 30-day plan', 'Review access and permissions'] },
]

const MORNING = [
  ['priority', "Today's content priority"],
  ['task', 'Recording or publishing task'],
  ['comments', 'Important comments'],
  ['growth', 'One growth action'],
  ['target', 'Measurable target'],
] as const
const EVENING = [
  ['completed', 'What got done'],
  ['links', 'Published links'],
  ['response', 'Response so far'],
  ['pending', 'Still pending'],
  ['tomorrow', "Tomorrow's priority"],
] as const

export default function Goals() {
  const s = useAppState()
  const t = today()
  const snaps = useFollowerSnapshots()
  const tiktok = latestSnapshot(snaps, 'tiktok')
  const prog = milestoneProgress(tiktok?.count, s.settings.tiktokGoal)
  const pos = campaignPosition(s.settings.campaignStart, t)
  const toggle = (key: string, v: boolean) => update((st) => ({ ...st, settings: { ...st.settings, planChecks: { ...st.settings.planChecks, [key]: v } } }))

  const success = [
    ['A verified baseline', snaps.some((x) => x.verified)],
    ['A sustainable publishing routine', s.content.filter((c) => c.status === 'published').length >= 5],
    ['An organized engagement queue', s.engagements.some((e) => !e.demo)],
    ['A few documented tests', s.experiments.filter((x) => x.status === 'done').length >= 2],
    ['An evidence-based next plan', !!s.settings.planChecks['p5-2']],
  ] as const

  return (
    <>
      <PageHeader eyebrow="Goals & Accountability" title="Milestones, routines and tasks">
        Missed something? No lecture. Note what blocked it and pick the smallest next action.
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>First {s.settings.tiktokGoal.toLocaleString()} TikTok followers</CardTitle>
          <ProgressBar pct={prog?.pct ?? null} label="Progress to the follower goal" />
          <p className="mt-3 text-sm text-muted">
            {prog ? `${tiktok!.count.toLocaleString()} now · ${prog.remaining.toLocaleString()} to go · ${tiktok!.verified ? 'verified' : 'unverified'}` : 'No baseline recorded yet.'}
          </p>
          <p className="mt-2 text-xs text-faint">An ambition, not a guaranteed result. Link eligibility depends on current TikTok rules; check account settings.</p>
        </Card>
        <Card>
          <CardTitle>What success looks like at day 30</CardTitle>
          <ul className="flex flex-col gap-2 text-sm">
            {success.map(([label, ok]) => (
              <li key={label} className="flex items-center gap-2">
                <span className={cx('size-2 rounded-full', ok ? 'bg-ok' : 'bg-ink-600')} />
                <span className={ok ? '' : 'text-muted'}>{label}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle right={<Badge tone="accent">{pos.status === 'active' ? `Day ${pos.day} of 30` : pos.status === 'complete' ? 'Complete' : 'Not started'}</Badge>}>First 30 days</CardTitle>
        <div className="grid gap-3 md:grid-cols-5">
          {PLAN.map((ph) => {
            const current = pos.day >= ph.days[0] && pos.day <= ph.days[1]
            return (
              <div key={ph.id} className={cx('rounded-xl border p-3', current ? 'border-accent/50 bg-accent/5' : 'border-ink-600')}>
                <div className="mb-3 text-xs font-medium">{ph.label}</div>
                <ul className="flex flex-col gap-2.5">
                  {ph.items.map((it, i) => {
                    const key = `${ph.id}-${i}`
                    return <li key={key} className="text-xs"><Checkbox checked={!!s.settings.planChecks[key]} onChange={(v) => toggle(key, v)} label={it} /></li>
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <CheckInCard kind="morning" fields={MORNING} checkins={s.checkins} />
        <CheckInCard kind="evening" fields={EVENING} checkins={s.checkins} />
      </div>

      <TaskList tasks={s.tasks} />
    </>
  )
}

function CheckInCard({ kind, fields, checkins }: { kind: CheckIn['kind']; fields: readonly (readonly [string, string])[]; checkins: CheckIn[] }) {
  const t = today()
  const existing = checkins.find((c) => c.date === t && c.kind === kind)
  const id = existing?.id ?? `CI-${t}-${kind}`
  const values = existing?.fields ?? {}
  const set = (k: string, v: string) => upsert('checkins', { id, date: t, kind, fields: { ...values, [k]: v } })
  return (
    <Card>
      <CardTitle right={<span className="text-xs text-muted">{shortDate(t)}</span>}>{kind === 'morning' ? 'Morning check-in' : 'Evening check-in'}</CardTitle>
      <div className="flex flex-col gap-3">
        {fields.map(([k, label]) => (
          <Field key={k} label={label}>{(fid) => <Input id={fid} value={values[k] ?? ''} onChange={(e) => set(k, e.target.value)} />}</Field>
        ))}
      </div>
      <p className="mt-3 text-xs text-faint">Saved as you type. Reminders need a connected tool and your authorization.</p>
    </Card>
  )
}

function TaskList({ tasks }: { tasks: Task[] }) {
  const t = today()
  const p = useProfile()
  const [f, setF] = useState({ title: '', owner: 'creator' as Owner, date: t })
  const groups: [string, Task[]][] = [
    ['Overdue', tasks.filter((x) => !x.done && x.date < t)],
    ['Today', tasks.filter((x) => !x.done && x.date === t)],
    ['Upcoming', tasks.filter((x) => !x.done && x.date > t)],
    ['Done', tasks.filter((x) => x.done)],
  ]
  return (
    <Card className="mt-4">
      <CardTitle>Tasks</CardTitle>
      <form
        className="mb-5 grid gap-3 sm:grid-cols-[1fr_7rem_10rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          if (!f.title.trim()) return
          upsert('tasks', { id: nextId('T', tasks), title: f.title.trim(), owner: f.owner, date: f.date, done: false, nextSmallestAction: '' })
          setF({ ...f, title: '' })
        }}
      >
        <Field label="Task">{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Owner">{(id) => <Select id={id} options={p.owners} value={f.owner} onChange={(owner) => setF({ ...f, owner })} />}</Field>
        <Field label="Date">{(id) => <Input id={id} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Button type="submit" variant="primary" disabled={!f.title.trim()}>Add task</Button>
      </form>
      <div className="flex flex-col gap-5">
        {groups.map(([label, list]) =>
          list.length === 0 ? null : (
            <section key={label}>
              <h3 className={cx('mb-2 text-xs tracking-wide uppercase', label === 'Overdue' ? 'text-warn' : 'text-muted')}>{label} · {list.length}</h3>
              <ul className="flex flex-col divide-y divide-ink-700">
                {list.map((x) => (
                  <li key={x.id} className="flex flex-col gap-2 py-2.5">
                    <div className="flex items-start gap-3">
                      <div className="flex-1"><Checkbox checked={x.done} onChange={(done) => patch('tasks', x.id, { done })} label={x.title} /></div>
                      <Mono>{x.owner}</Mono>
                      <span className="w-14 text-right text-xs text-muted">{shortDate(x.date)}</span>
                      <button className="flex size-6 shrink-0 items-center justify-center rounded text-faint hover:text-danger" aria-label="Delete task" onClick={() => remove('tasks', x.id)}><Trash2 size={14} /></button>
                    </div>
                    {label === 'Overdue' && (
                      <div className="flex flex-wrap gap-2 pl-7">
                        <Textarea
                          rows={1}
                          className="min-w-0 flex-1 text-xs"
                          placeholder="What blocked it? What's the smallest next action?"
                          value={x.nextSmallestAction}
                          onChange={(e) => patch('tasks', x.id, { nextSmallestAction: e.target.value })}
                        />
                        <Button size="sm" onClick={() => patch('tasks', x.id, { date: t })}>Move to today</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
    </Card>
  )
}
