'use client'

import Link from 'next/link'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, CardTitle, CopyButton, Empty, Field, Input, Mono, Notice, PageHeader, Select, Textarea } from '../components/ui'
import { cx } from '../lib/cx'
import { nowStamp, today } from '../lib/dates'
import { CATEGORY, ENGAGEMENT_PLATFORM, NEEDS_ACTION, REPLY_STATUS } from '../lib/labels'
import { alreadyHandled, campaignFor, fillTemplate, isRepeatReply, keywordActivationError, matchKeywords, nextId, replyApproveError, replyRiskWarnings, sameRecipient } from '../lib/rules'
import { patch, remove, upsert, useAppState } from '../lib/store'
import type { CommentCategory, Engagement, EngagementPlatform, KeywordRule, LeadType, ReplyStatus, Resource } from '../lib/types'

const TABS: Record<string, { label: string; statuses: ReplyStatus[] }> = {
  todo: { label: 'Needs action', statuses: NEEDS_ACTION },
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
        Everyone who needs an answer, with a draft reply in your voice. Approve a reply, then post it yourself or send it via {s.profile.agents.creative.name}. Nothing is sent without your approval.
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

      <Resources resources={s.resources} keywords={s.keywords} />
      <KeywordRules rules={s.keywords} resources={s.resources} />
    </>
  )
}

function CommentForm() {
  const s = useAppState()
  const empty = { platform: 'tiktok' as EngagementPlatform, sourcePost: '', author: '', comment: '' }
  const [f, setF] = useState(empty)
  const matches = f.comment ? matchKeywords(f.comment, s.keywords, f.sourcePost) : []
  return (
    <Card>
      <CardTitle>Add a comment or mention</CardTitle>
      <form
        className="grid gap-3"
        onSubmit={(ev) => {
          ev.preventDefault()
          if (!f.comment.trim()) return
          const rule = matches[0]
          const draft = rule ? fillTemplate(rule.replyTemplate, f.author) : ''
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
          <Field label="Platform">{(id) => <Select id={id} options={ENGAGEMENT_PLATFORM} value={f.platform} onChange={(platform) => setF({ ...f, platform })} />}</Field>
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
  // A DM from an active campaign is the approved delivery, and its text is meant to repeat.
  const campaign = campaignFor(e, s.keywords)
  const resource = campaign && s.resources.find((r) => r.id === campaign.resourceId)
  const warnings = replyRiskWarnings(e.draftReply, s.profile.creatorName).filter((w) => !(campaign && w.startsWith('Mentions a DM')))
  const repeat = !campaign && isRepeatReply(e.draftReply, s.engagements, e.id)
  const already = sameRecipient(e, s.engagements)
  const sent = already.filter(alreadyHandled)
  const answered = e.status !== 'posted_by_day' && alreadyHandled(e)
  const locked = e.status === 'posted_by_day' || e.status === 'dismissed'
  const link = /^https?:\/\/\S+$/.test(e.sourcePost.trim()) ? e.sourcePost.trim() : null
  const creative = s.profile.agents.creative.name
  const creativeLane = (['tiktok', 'threads', 'instagram'] as const).includes(e.platform as 'tiktok')
  // A send request counts only for the text it carried: after the reply is edited and re-approved, it can be sent again.
  const sendRequested = !!e.draftReply.trim() && s.handoffs.some((h) => h.to === 'creative' && h.refs?.some((r) => r.collection === 'engagement_queue' && r.id === e.id) && h.message.includes(e.draftReply))
  const askToSend = () => {
    const where = [ENGAGEMENT_PLATFORM[e.platform], e.account, e.author && `@${e.author.replace(/^@/, '')}`].filter(Boolean).join(' · ')
    upsert('handoffs', {
      id: nextId('H', s.handoffs),
      from: 'creator',
      to: 'creative',
      itemId: `AUDIT-${today()}`,
      type: 'question',
      message: `Send the approved reply on ${e.id} (${where}${link ? `, ${link}` : ''}). First open your conversation with them and the comment's replies: if ${s.profile.creatorName} already messaged them this link or answered there, do not send; add "Not sent: already DM'd by the creator, <date>" (or "already replied") to the note of ${e.id} instead. Otherwise send exactly this text, once:\n\n${e.draftReply}\n\nThen add "Sent by the creative agent, <time>" to the note of ${e.id}. ${s.profile.creatorName} marks it posted.`,
      refs: [{ collection: 'engagement_queue', id: e.id }],
      createdAt: nowStamp(),
      acknowledged: false,
    })
  }

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
        <span className="text-muted">{ENGAGEMENT_PLATFORM[e.platform]}{e.account ? ` · ${e.account}` : ''}</span>
        {e.author && <span className="text-muted">@{e.author.replace(/^@/, '')}</span>}
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            Open on {ENGAGEMENT_PLATFORM[e.platform]} ↗
          </a>
        ) : (
          e.sourcePost && <span className="truncate text-faint">on {e.sourcePost}</span>
        )}
        {e.keyword && <Badge tone="accent">{e.keyword}</Badge>}
        <span className="ml-auto"><Badge tone={e.status === 'escalated' ? 'danger' : e.status === 'approved' ? 'ok' : 'neutral'}>{REPLY_STATUS[e.status]}</Badge></span>
      </header>
      <p className="mt-3 text-sm">“{e.comment}”</p>
      {e.note && <p className="mt-1 text-xs text-muted">Note: {e.note}</p>}

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
      {campaign && (
        <p className="mt-2 text-xs text-muted">
          Campaign DM: <Mono>{campaign.keyword}</Mono>{resource ? ` → ${resource.name}` : ''}
        </p>
      )}
      {answered && <Notice tone="danger">Already answered: {e.note}. Don't send this again.</Notice>}
      {already.length > 0 && (
        <Notice tone={sent.length ? 'danger' : 'neutral'}>
          {sent.length ? 'Already sent to' : 'Already in the queue for'} @{e.author.replace(/^@/, '')}: {already.map((o) => `${o.id} (${REPLY_STATUS[o.status]}${alreadyHandled(o) ? ', answered' : ''})`).join(', ')}. Don't DM them twice.
        </Notice>
      )}
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
              {link && (
                <a href={link} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm hover:bg-ink-800">
                  Open to reply ↗
                </a>
              )}
              {creativeLane && (
                <Button size="sm" disabled={sendRequested || answered || sent.length > 0} onClick={() => confirm(`Ask ${creative} to send this exact reply on ${ENGAGEMENT_PLATFORM[e.platform]}?`) && askToSend()} title={sendRequested ? `Already asked ${creative}` : `${creative} sends it on its next run`}>
                  {sendRequested ? `Asked ${creative} to send` : `Send via ${creative}`}
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={() => set({ status: 'posted_by_day' })}>I posted it</Button>
              <Button size="sm" variant="ghost" onClick={() => set({ status: 'drafted' })}>Edit again</Button>
            </>
          )}
          {e.status !== 'escalated' && <Button size="sm" variant="ghost" onClick={() => set({ status: 'escalated' })}>Escalate to {s.profile.creatorName}</Button>}
          {['client_inquiry', 'collaboration'].includes(e.category) && !e.leadId && (
            <Button size="sm" onClick={() => flagLead(e.category === 'collaboration' ? 'collaboration' : 'client_inquiry')}>Flag as lead</Button>
          )}
          {e.leadId && <Link href="/revenue" className="text-xs text-accent">Lead {e.leadId}</Link>}
          <Button
            size="sm"
            className="ml-auto"
            title="You already answered this in the app. Marks it done so nobody answers again."
            onClick={() => set({ status: 'posted_by_day', note: [e.note.trim(), `Manually replied by ${s.profile.creatorName}, ${nowStamp()}`].filter(Boolean).join(' · ') })}
          >
            Manually replied
          </Button>
          <Button size="sm" variant="ghost" onClick={() => set({ status: 'dismissed' })}>Dismiss</Button>
        </footer>
      )}
    </article>
  )
}

function Resources({ resources, keywords }: { resources: Resource[]; keywords: KeywordRule[] }) {
  const empty = { name: '', url: '', description: '' }
  const [f, setF] = useState(empty)
  const valid = f.name.trim() && /^https:\/\/\S+$/.test(f.url.trim())
  return (
    <Card className="mt-4">
      <CardTitle>Resources</CardTitle>
      <p className="mb-4 text-sm text-muted">What you give out: guides, templates, product links. Keyword campaigns deliver one of these, and only these.</p>
      <div className="flex flex-col gap-2">
        {resources.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm">
            <Mono>{r.id}</Mono>
            <span className="font-medium">{r.name}</span>
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-accent hover:underline">{r.url}</a>
            {r.description && <span className="w-full text-xs text-muted">{r.description}</span>}
            <CopyButton text={r.url} label="Copy link" />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (!confirm(`Delete resource ${r.name}? Campaigns using it switch off.`)) return
                for (const k of keywords.filter((x) => x.resourceId === r.id)) patch('keywords', k.id, { resourceId: '', approvedResource: '', active: false })
                remove('resources', r.id)
              }}
            >
              <Trash2 size={14} /> Delete
            </Button>
          </div>
        ))}
        {!resources.length && <Empty title="No resources yet" />}
      </div>
      <form
        className="mt-4 grid gap-2 sm:grid-cols-[12rem_1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          upsert('resources', { id: nextId('RS', resources), name: f.name.trim(), url: f.url.trim(), description: f.description.trim() })
          setF(empty)
        }}
      >
        <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name" aria-label="Resource name" />
        <Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https:// link (no tracking params)" aria-label="Resource link" />
        <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What it is (optional)" aria-label="Resource description" />
        <Button type="submit" disabled={!valid}>Add resource</Button>
      </form>
    </Card>
  )
}

/** One link per line. Typing stays free; the list is saved when the box loses focus. */
function PostUrls({ id, urls, onChange }: { id: string; urls: string[]; onChange: (urls: string[]) => void }) {
  const [text, setText] = useState(urls.join('\n'))
  const parsed = text.split(/\s+/).map((u) => u.trim()).filter(Boolean)
  const bad = parsed.filter((u) => !/^https?:\/\/\S+$/.test(u))
  return (
    <>
      <Textarea
        id={id}
        rows={3}
        value={text}
        placeholder={'https://www.tiktok.com/@you/video/…\nhttps://www.tiktok.com/@you/video/…'}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const next = parsed.filter((u) => /^https?:\/\/\S+$/.test(u))
          if (next.join('\n') !== urls.join('\n')) onChange(next)
        }}
      />
      {bad.length > 0 && <span className="text-xs text-warn">Not a link, will be skipped: {bad.join(', ')}</span>}
    </>
  )
}

function KeywordRules({ rules, resources }: { rules: KeywordRule[]; resources: Resource[] }) {
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
              <Field label="Resource">
                {(id) => (
                  <Select
                    id={id}
                    options={{ '': 'Choose a resource', ...Object.fromEntries(resources.map((x) => [x.id, x.name])) }}
                    value={r.resourceId ?? ''}
                    onChange={(resourceId: string) => {
                      const x = resources.find((y) => y.id === resourceId)
                      set(r, { resourceId, approvedResource: x ? `${x.name}: ${x.url}` : '' })
                    }}
                  />
                )}
              </Field>
              <Field label="Delivery method" hint="e.g. Link in bio, pinned comment">{(id) => <Input id={id} value={r.deliveryMethod} onChange={(e) => set(r, { deliveryMethod: e.target.value })} />}</Field>
              <Field label="Exact CTA" className="sm:col-span-2">
                {(id) => (
                  <>
                    <p className="text-xs text-faint">What you say in the video. New CTA per line.</p>
                    <Textarea id={id} rows={3} value={r.cta} onChange={(e) => set(r, { cta: e.target.value })} />
                  </>
                )}
              </Field>
              <Field label="Only on these posts" hint="One link per line. Empty: any post." className="sm:col-span-2">
                {(id) => <PostUrls id={id} urls={r.postUrls ?? []} onChange={(postUrls) => set(r, { postUrls })} />}
              </Field>
              <Field label="Starting reply (edit per comment)" hint="{name} becomes the person's name or handle." className="sm:col-span-2">
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
          upsert('keywords', { id: nextId('K', rules), keyword: kw, approvedResource: '', deliveryMethod: '', cta: '', replyTemplate: '', active: false, resourceId: '', postUrls: [] })
          setNewKw('')
        }}
      >
        <Input value={newKw} onChange={(e) => setNewKw(e.target.value)} placeholder="New keyword" aria-label="New keyword" />
        <Button type="submit" disabled={!newKw.trim()}>Add keyword</Button>
      </form>
    </Card>
  )
}
