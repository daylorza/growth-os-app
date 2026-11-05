import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, CardTitle, CopyButton, Empty, Field, Input, Mono, Notice, PageHeader, Select, Textarea } from '../components/ui'
import { cx } from '../lib/cx'
import { nowStamp, today } from '../lib/dates'
import { CATEGORY, PLATFORM, REPLY_STATUS } from '../lib/labels'
import { isRepeatReply, keywordActivationError, matchKeywords, nextId, replyApproveError, replyRiskWarnings } from '../lib/rules'
import { patch, remove, upsert, useAppState } from '../lib/store'
import type { CommentCategory, Engagement, KeywordRule, LeadType, Platform, ReplyStatus } from '../lib/types'

const TABS: Record<string, { label: string; statuses: ReplyStatus[] }> = {
  todo: { label: 'Needs action', statuses: ['new', 'drafted', 'escalated'] },
  approved: { label: 'Approved to post', statuses: ['approved'] },
  done: { label: 'Done', statuses: ['posted_by_day', 'dismissed'] },
}

export default function EngagementHub() {
  const s = useAppState()
  const [tab, setTab] = useState<keyof typeof TABS>('todo')
  const list = s.engagements
    .filter((e) => TABS[tab].statuses.includes(e.status))
    .sort((a, b) => Number(b.status === 'escalated') - Number(a.status === 'escalated') || b.createdAt.localeCompare(a.createdAt))

  return (
    <>
      <PageHeader eyebrow="Engagement Hub" title="Comments, keywords and conversations">
        Paste comments in, classify them and draft replies in your voice. Nothing is sent from here: copy an approved reply and post it yourself.
      </PageHeader>

      <CommentForm />

      <Card className="mt-4">
        <div className="mb-4 flex flex-wrap gap-1">
          {Object.entries(TABS).map(([k, t]) => {
            const n = s.engagements.filter((e) => t.statuses.includes(e.status)).length
            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cx('rounded-lg px-3 py-1.5 text-sm', tab === k ? 'bg-ink-700 text-fg' : 'text-muted hover:text-fg')}
              >
                {t.label} <span className="ml-1 text-xs text-faint tabular-nums">{n}</span>
              </button>
            )
          })}
        </div>
        {list.length === 0 ? (
          <Empty title={tab === 'todo' ? 'Inbox clear' : 'Nothing here yet'}>
            {tab === 'todo' && 'Paste the next comment worth answering above.'}
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {list.map((e) => (
              <EngagementCard key={e.id} e={e} />
            ))}
          </div>
        )}
      </Card>

      <KeywordRules rules={s.keywords} />
    </>
  )
}

function CommentForm() {
  const s = useAppState()
  const empty = { platform: 'tiktok' as Platform, sourcePost: '', author: '', comment: '' }
  const [f, setF] = useState(empty)
  const matches = f.comment ? matchKeywords(f.comment, s.keywords) : []
  return (
    <Card>
      <CardTitle>Add a comment or mention</CardTitle>
      <form
        className="grid gap-3"
        onSubmit={(ev) => {
          ev.preventDefault()
          if (!f.comment.trim()) return
          const rule = matches[0]
          const draft = rule?.replyTemplate ?? ''
          upsert('engagements', {
            id: nextId('E', s.engagements),
            ...f,
            keyword: matches.map((m) => m.keyword).join(', '),
            category: 'question',
            draftReply: draft,
            status: draft ? 'drafted' : 'new',
            leadId: '',
            note: '',
            createdAt: nowStamp(),
            updatedAt: nowStamp(),
          })
          setF(empty)
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr]">
          <Field label="Platform">{(id) => <Select id={id} options={PLATFORM} value={f.platform} onChange={(platform) => setF({ ...f, platform })} />}</Field>
          <Field label="Source post (ID or URL)">{(id) => <Input id={id} value={f.sourcePost} onChange={(e) => setF({ ...f, sourcePost: e.target.value })} />}</Field>
          <Field label="Handle" hint="Public handle only. No personal details.">
            {(id) => <Input id={id} value={f.author} onChange={(e) => setF({ ...f, author: e.target.value })} />}
          </Field>
        </div>
        <Field label="Comment">{(id) => <Textarea id={id} value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} />}</Field>
        <div className="flex flex-wrap items-center gap-2">
          {matches.map((m) => (
            <Badge key={m.id} tone={m.active ? 'accent' : 'neutral'}>
              {m.keyword}
              {!m.active && ' · inactive'}
            </Badge>
          ))}
          <Button type="submit" variant="primary" className="ml-auto" disabled={!f.comment.trim()}>
            <Plus size={16} /> Add to queue
          </Button>
        </div>
      </form>
    </Card>
  )
}

function EngagementCard({ e }: { e: Engagement }) {
  const s = useAppState()
  const [error, setError] = useState<string | null>(null)
  const set = (changes: Partial<Engagement>) => {
    patch('engagements', e.id, { ...changes, updatedAt: nowStamp() })
    setError(null)
  }
  const warnings = replyRiskWarnings(e.draftReply, s.profile.creatorName)
  const repeat = isRepeatReply(e.draftReply, s.engagements, e.id)
  const locked = e.status === 'posted_by_day' || e.status === 'dismissed'

  const flagLead = (type: LeadType) => {
    const id = nextId('L', s.leads)
    upsert('leads', {
      id,
      handle: e.author,
      platform: e.platform,
      type,
      status: 'new',
      summary: e.comment.slice(0, 200),
      nextStep: `${s.profile.creatorName} to review`,
      source: `${e.id} · ${e.sourcePost}`,
      revenueEvidence: '',
      createdAt: today(),
    })
    set({ leadId: id })
  }

  return (
    <article className={cx('rounded-xl border bg-ink-900 p-4', e.status === 'escalated' ? 'border-danger/40' : 'border-ink-600')}>
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <Mono>{e.id}</Mono>
        <span className="text-muted">{PLATFORM[e.platform]}</span>
        {e.author && <span className="text-muted">@{e.author.replace(/^@/, '')}</span>}
        {e.sourcePost && <span className="truncate text-faint">on {e.sourcePost}</span>}
        {e.keyword && <Badge tone="accent">{e.keyword}</Badge>}
        {e.demo && <Badge>Demo</Badge>}
        <span className="ml-auto"><Badge tone={e.status === 'escalated' ? 'danger' : e.status === 'approved' ? 'ok' : 'neutral'}>{REPLY_STATUS[e.status]}</Badge></span>
      </header>
      <p className="mt-3 text-sm">“{e.comment}”</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-[14rem_1fr]">
        <Field label="Category">
          {(id) => (
            <Select
              id={id}
              disabled={locked}
              options={CATEGORY}
              value={e.category}
              onChange={(category: CommentCategory) => set(category === 'sensitive' ? { category, status: 'escalated' } : { category })}
            />
          )}
        </Field>
        <Field label="Draft reply in your voice">
          {(id) => (
            <Textarea
              id={id}
              disabled={locked || e.status === 'approved'}
              value={e.draftReply}
              onChange={(ev) => set({ draftReply: ev.target.value, status: e.status === 'new' && ev.target.value ? 'drafted' : e.status })}
            />
          )}
        </Field>
      </div>
      {(warnings.length > 0 || repeat || error) && (
        <div className="mt-2 flex flex-col gap-1">
          {error && <Notice tone="danger">{error}</Notice>}
          {warnings.map((w) => <Notice key={w}>{w}</Notice>)}
          {repeat && <Notice>Same reply used elsewhere. Make it specific to this comment.</Notice>}
        </div>
      )}
      {e.category === 'sensitive' && (
        <Notice tone="danger">Sensitive: threats, harassment, legal or financial claims, personal info, disputes, security or client complaints go to {s.profile.creatorName}. Do not argue, delete or block.</Notice>
      )}

      {!locked && (
        <footer className="mt-3 flex flex-wrap items-center gap-2">
          {e.status !== 'approved' ? (
            <Button size="sm" variant="primary" onClick={() => {
              const err = replyApproveError(e, s.profile.creatorName)
              if (err) setError(err)
              else set({ status: 'approved' })
            }}>
              Approve reply ({s.profile.creatorName})
            </Button>
          ) : (
            <>
              <CopyButton text={e.draftReply} label="Copy reply" />
              <Button size="sm" variant="primary" onClick={() => set({ status: 'posted_by_day' })}>I posted it</Button>
              <Button size="sm" variant="ghost" onClick={() => set({ status: 'drafted' })}>Edit again</Button>
            </>
          )}
          {e.status !== 'escalated' && <Button size="sm" variant="ghost" onClick={() => set({ status: 'escalated' })}>Escalate to {s.profile.creatorName}</Button>}
          {['client_inquiry', 'collaboration'].includes(e.category) && !e.leadId && (
            <Button size="sm" onClick={() => flagLead(e.category === 'collaboration' ? 'collaboration' : 'client_inquiry')}>Flag as lead</Button>
          )}
          {e.leadId && <a href="#/revenue" className="text-xs text-accent">Lead {e.leadId}</a>}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => set({ status: 'dismissed' })}>Dismiss</Button>
        </footer>
      )}
    </article>
  )
}

function KeywordRules({ rules }: { rules: KeywordRule[] }) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [newKw, setNewKw] = useState('')
  const set = (r: KeywordRule, changes: Partial<KeywordRule>) => {
    const next = { ...r, ...changes }
    // Editing a live rule re-checks it; a rule that loses its resource is switched off.
    patch('keywords', r.id, keywordActivationError(next) ? { ...changes, active: false } : changes)
  }
  return (
    <Card className="mt-4">
      <CardTitle>Keyword campaigns</CardTitle>
      <p className="mb-4 text-sm text-muted">
        Only ask viewers to comment a keyword once there is a real, approved resource and a delivery method you can actually fulfil. Never promise a DM that cannot be sent.
      </p>
      <div className="flex flex-col gap-3">
        {rules.map((r) => (
          <details key={r.id} className="group rounded-xl border border-ink-600 bg-ink-900">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
              <span className="font-mono text-sm">{r.keyword}</span>
              <Badge tone={r.active ? 'ok' : 'neutral'}>{r.active ? 'Active' : 'Inactive'}</Badge>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{r.approvedResource || 'No approved resource yet'}</span>
            </summary>
            <div className="grid gap-3 border-t border-ink-600 p-4 sm:grid-cols-2">
              <Field label="Approved resource">{(id) => <Input id={id} value={r.approvedResource} onChange={(e) => set(r, { approvedResource: e.target.value })} />}</Field>
              <Field label="Delivery method" hint="e.g. Link in bio, pinned comment">{(id) => <Input id={id} value={r.deliveryMethod} onChange={(e) => set(r, { deliveryMethod: e.target.value })} />}</Field>
              <Field label="Exact CTA" className="sm:col-span-2">{(id) => <Input id={id} value={r.cta} onChange={(e) => set(r, { cta: e.target.value })} />}</Field>
              <Field label="Starting reply (edit per comment)" className="sm:col-span-2">
                {(id) => <Textarea id={id} value={r.replyTemplate} onChange={(e) => set(r, { replyTemplate: e.target.value })} />}
              </Field>
              {errors[r.id] && <div className="sm:col-span-2"><Notice tone="danger">{errors[r.id]}</Notice></div>}
              <div className="flex gap-2 sm:col-span-2">
                <Button
                  size="sm"
                  variant={r.active ? 'secondary' : 'primary'}
                  onClick={() => {
                    const err = r.active ? null : keywordActivationError(r)
                    setErrors({ ...errors, [r.id]: err ?? '' })
                    if (!err) patch('keywords', r.id, { active: !r.active })
                  }}
                >
                  {r.active ? 'Deactivate' : 'Activate'}
                </Button>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => confirm(`Delete keyword ${r.keyword}?`) && remove('keywords', r.id)}>
                  <Trash2 size={14} /> Delete
                </Button>
              </div>
            </div>
          </details>
        ))}
      </div>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const kw = newKw.trim().toUpperCase()
          if (!kw) return
          upsert('keywords', { id: nextId('K', rules), keyword: kw, approvedResource: '', deliveryMethod: '', cta: '', replyTemplate: '', active: false })
          setNewKw('')
        }}
      >
        <Input value={newKw} onChange={(e) => setNewKw(e.target.value)} placeholder="New keyword" aria-label="New keyword" />
        <Button type="submit" disabled={!newKw.trim()}>Add keyword</Button>
      </form>
    </Card>
  )
}
