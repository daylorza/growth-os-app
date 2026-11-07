'use client'

import Link from 'next/link'
import { CalendarDays, ChartNoAxesColumnIncreasing, ListChecks, Sparkles, SquareCheck, Target, Users, Video } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Badge, Button, Card, CardTitle, Checkbox, Empty, Input, PageHeader, ProgressBar, Stat } from '../components/ui'
import { campaignPosition, parseDate, today, weekRange } from '../lib/dates'
import { BRIEF_FIELDS, UNKNOWN, withProject } from '../lib/labels'
import type { Profile } from '../lib/types'
import { latestSnapshot, milestoneProgress } from '../lib/metrics'
import { nextId } from '../lib/rules'
import { patch, upsert, useAppState } from '../lib/store'
import { useFollowerSnapshots } from '../lib/tiktokData'

function weeklyLoopFocus(on: string, p: Profile) {
  const dow = parseDate(on).getDay()
  if (dow === 1) return `Monday review: ${p.agents.analyst.name} reviews results and questions, ${p.agents.creative.name} proposes three priorities and one experiment, you pick the work.`
  if (dow === 0 || dow === 6) return 'Weekend: write the weekly report, review open leads and plan next week.'
  return 'Create, record, approve and engage. Log real links and results as you go.'
}

export default function Overview() {
  const s = useAppState()
  const [newTask, setNewTask] = useState('')
  const t = today()
  const snaps = useFollowerSnapshots()
  const tiktok = latestSnapshot(snaps, 'tiktok')
  const progress = milestoneProgress(tiktok?.count, s.settings.tiktokGoal)
  const { start, end } = weekRange(t)
  const publishedThisWeek = s.content.filter(
    (c) => c.platform === 'tiktok' && c.status === 'published' && c.publishedAt >= start && c.publishedAt <= end,
  ).length
  const pos = campaignPosition(s.settings.campaignStart, t)
  const todays = s.tasks.filter((x) => x.date === t)
  const overdue = s.tasks.filter((x) => x.date < t && !x.done)
  const toReview = s.content.filter((c) => c.status === 'needs_review' || (c.status === 'draft' && c.approval === 'pending'))
  const repliesToReview = s.engagements.filter((e) => e.status === 'drafted' || e.status === 'escalated')
  const unknowns = BRIEF_FIELDS.filter((f) => s.brief[f.key].value.trim() === UNKNOWN || !s.brief[f.key].value.trim())

  const addTask = () => {
    if (!newTask.trim()) return
    upsert('tasks', { id: nextId('T', s.tasks), title: newTask.trim(), owner: 'creator', date: t, done: false, nextSmallestAction: '' })
    setNewTask('')
  }

  return (
    <>
      <PageHeader eyebrow="Overview" title="Mission Control">Your performance, priorities and reviews in one place.</PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="TikTok Followers"
          icon={<Users size={20} />}
          value={tiktok ? tiktok.count.toLocaleString() : UNKNOWN}
          note={tiktok ? (tiktok.verified ? `Verified · ${tiktok.date} · ${tiktok.id.startsWith('TT-') ? 'TikTok export' : 'manual'}` : `Unverified · ${tiktok.source}`) : 'Add a snapshot in Audience Growth'}
        />
        <Stat label="Growth Target" icon={<Target size={20} />} value={s.settings.tiktokGoal.toLocaleString()} note="Milestone, not a guarantee" />
        <Stat
          label="Weekly Videos"
          icon={<Video size={20} />}
          value={`${publishedThisWeek} / ${s.settings.weeklyTikTokTarget}`}
          note="TikToks logged as published this week"
        />
        <Stat
          label="30-Day Campaign"
          icon={<CalendarDays size={20} />}
          value={pos.status === 'not_started' ? 'Not started' : pos.status === 'complete' ? 'Complete' : `Week ${pos.week}`}
          note={pos.status === 'active' ? `Day ${pos.day} of 30` : `Starts ${s.settings.campaignStart}`}
        />
      </div>

      <Card className="mt-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-medium">First {s.settings.tiktokGoal.toLocaleString()} Followers</h2>
          <span className="text-accent tabular-nums">{progress ? `${Math.round(progress.pct)}%` : '—'}</span>
        </div>
        <div className="mt-4">
          <ProgressBar pct={progress?.pct ?? 0} />
        </div>
        <p className="mt-3 text-sm text-muted">
          {progress
            ? `${progress.remaining.toLocaleString()} followers remaining · ${tiktok?.verified ? 'Verified baseline' : 'Illustrative baseline'}`
            : 'No baseline yet. Record your current TikTok follower count to start tracking.'}
        </p>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardTitle icon={<SquareCheck size={20} />}>Today's priorities</CardTitle>
          {todays.length === 0 && <p className="mb-3 text-sm text-muted">Nothing planned for today. Add one small thing.</p>}
          <ul className="flex flex-col gap-3">
            {todays.map((x) => (
              <li key={x.id}>
                <Checkbox checked={x.done} onChange={(done) => patch('tasks', x.id, { done })} label={x.title} />
              </li>
            ))}
          </ul>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              addTask()
            }}
          >
            <Input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Add a priority for today" aria-label="New priority" />
            <Button type="submit" disabled={!newTask.trim()}>
              Add
            </Button>
          </form>
          {overdue.length > 0 && (
            <p className="mt-3 text-xs text-warn">
              {overdue.length} earlier task{overdue.length > 1 ? 's' : ''} still open. <Link className="underline" href="/goals">Pick the smallest next step</Link>
            </p>
          )}
        </Card>

        <Card>
          <CardTitle icon={<ListChecks size={20} />}>Waiting on you</CardTitle>
          <ul className="flex flex-col gap-3 text-sm">
            <li className="flex items-center justify-between gap-3">
              <Link href="/studio" className="hover:text-accent">Content to review</Link>
              <Badge tone={toReview.length ? 'accent' : 'neutral'}>{toReview.length}</Badge>
            </li>
            <li className="flex items-center justify-between gap-3">
              <Link href="/engagement" className="hover:text-accent">Replies and escalations</Link>
              <Badge tone={repliesToReview.length ? 'accent' : 'neutral'}>{repliesToReview.length}</Badge>
            </li>
            <li className="flex items-center justify-between gap-3">
              <Link href="/settings" className="hover:text-accent">Brief fields still UNKNOWN</Link>
              <Badge tone={unknowns.length ? 'warn' : 'ok'}>{unknowns.length}</Badge>
            </li>
          </ul>
          <p className="mt-4 border-t border-ink-600 pt-4 text-xs leading-relaxed text-muted">{weeklyLoopFocus(t, s.profile)}</p>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <AgentCard icon={<ChartNoAxesColumnIncreasing size={20} />} name={s.profile.agents.analyst.name} role="Analytics & engagement" />
        <AgentCard icon={<Sparkles size={20} />} name={s.profile.agents.creative.name} role="Creative & scripts" />
      </div>

      {unknowns.length > 0 && (
        <Card className="mt-4">
          <CardTitle right={<Link href="/settings" className="text-xs text-accent">Fill in the brief</Link>}>Missing inputs</CardTitle>
          {unknowns.length === 0 ? (
            <Empty title="Brief complete" />
          ) : (
            <ul className="grid gap-x-6 gap-y-2 text-sm text-muted sm:grid-cols-2">
              {unknowns.slice(0, 6).map((f) => (
                <li key={f.key}>· {withProject(f.label, s.profile.projectName)}</li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  )
}

function AgentCard({ icon, name, role }: { icon: ReactNode; name: string; role: string }) {
  return (
    <Link href="/agents" className="block">
      <Card className="transition-colors hover:border-accent/40">
        <div className="flex items-center gap-3">
          <span className="text-accent">{icon}</span>
          <span className="text-base font-medium">{name}</span>
        </div>
        <p className="mt-2 text-sm text-muted">{role}</p>
        <div className="mt-3">
          <Badge>Not connected</Badge>
        </div>
      </Card>
    </Link>
  )
}
