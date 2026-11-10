'use client'

import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, CardTitle, ConfirmButton, Field, Input, Mono, Notice, Textarea } from '../components/ui'
import { fromLocalInput, shortDateTime, toLocalInput } from '../lib/dates'
import { PLATFORM, PLATFORMS, TARGET_STATUS, TARGET_TONE } from '../lib/labels'
import { useProfile } from '../lib/profile'
import { mediaUrlError, MIN_LEAD_MINUTES, targetApproveError } from '../lib/rules'
import { patch, useAppState, useSyncStatus } from '../lib/store'
import { fmt } from '../lib/metrics'
import type { ContentItem, Platform, PublishTarget, TargetMetrics } from '../lib/types'

const blank = (platform: Platform): PublishTarget => ({ platform, caption: '', scheduledAt: '', status: 'draft', bufferPostId: '', liveUrl: '', error: '' })

/** A starting caption for each platform from the brief: TikTok gets the hashtags, X its own adaptation. */
const startingCaption = (c: ContentItem, p: Platform) =>
  p === 'x' ? c.xAdaptation || c.caption : p === 'tiktok' ? [c.caption, c.hashtags].filter((s) => s.trim()).join('\n\n') : c.caption

/** The planned date at 6 PM in this browser's time zone, if that is still ahead. */
const startingTime = (c: ContentItem) => {
  const iso = fromLocalInput(`${c.plannedDate}T18:00`)
  return iso && Date.parse(iso) > Date.now() + MIN_LEAD_MINUTES * 60_000 ? iso : ''
}

/** Platform versions in flight: the media link is locked while any is approved or scheduled. */
const inFlight = (targets: PublishTarget[]) => targets.some((t) => t.status === 'approved' || t.status === 'scheduled')

/** Per-platform captions, times and approvals for one content item. Buffer publishes each approved version at its time. */
export function CrossPost({ item: c }: { item: ContentItem }) {
  const p = useProfile()
  const who = p.creatorName
  const mode = useSyncStatus().mode
  const targets = c.targets ?? []
  const [media, setMedia] = useState(c.mediaUrl ?? '')
  const mediaError = mediaUrlError(media)
  const locked = inFlight(targets)

  const save = (next: PublishTarget[]) => patch('content', c.id, { targets: next })
  const change = (platform: Platform, changes: Partial<PublishTarget>) => save(targets.map((t) => (t.platform === platform ? { ...t, ...changes } : t)))
  const add = (platform: Platform) => save([...targets, { ...blank(platform), caption: startingCaption(c, platform), scheduledAt: startingTime(c) }])
  const drop = (platform: Platform) => save(targets.filter((t) => t.platform !== platform))
  const saveMedia = () => {
    if (!mediaError && media.trim() !== (c.mediaUrl ?? '')) patch('content', c.id, { mediaUrl: media.trim() })
  }

  return (
    <fieldset className="grid gap-4 rounded-xl border border-ink-600 p-4">
      <legend className="px-1 text-xs text-muted">Publish through Buffer</legend>
      {mode !== 'endpoint' && (
        <Notice tone="accent">Buffer publishing runs on your Growth OS server. In this browser-only workspace, versions are saved here but nothing reaches Buffer.</Notice>
      )}
      <Field label="Media link" hint={mediaError ?? 'A public https file link (video or image). Buffer fetches it when it publishes, so it must not expire.'}>
        {(id) => (
          <Input
            id={id}
            type="url"
            placeholder="https://"
            value={media}
            readOnly={locked}
            aria-invalid={!!mediaError}
            title={locked ? 'Unapprove or cancel the approved and scheduled versions to change the media.' : undefined}
            onChange={(e) => setMedia(e.target.value)}
            onBlur={saveMedia}
          />
        )}
      </Field>
      {PLATFORMS.map((platform) => {
        const t = targets.find((x) => x.platform === platform)
        return t ? (
          <TargetRow key={platform} item={c} t={t} who={who} onChange={(changes) => change(platform, changes)} onRemove={() => drop(platform)} />
        ) : (
          <Button key={platform} variant="ghost" className="justify-start" onClick={() => add(platform)}>
            <Plus size={14} /> Add a {PLATFORM[platform]} version
          </Button>
        )
      })}
    </fieldset>
  )
}

function TargetRow({ item, t, who, onChange, onRemove }: { item: ContentItem; t: PublishTarget; who: string; onChange: (c: Partial<PublishTarget>) => void; onRemove: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const name = PLATFORM[t.platform]
  const editable = t.status === 'draft'
  const removable = (t.status === 'draft' || t.status === 'cancelled' || t.status === 'failed') && !t.bufferPostId
  const blocked = editable ? targetApproveError(item, t, who) : null
  const approveLabel = `Approve for Buffer (${who})`

  return (
    <div className="grid gap-3 rounded-lg border border-ink-700 p-3" data-testid={`target-${t.platform}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{name}</span>
        {t.retry && t.status === 'cancelled' ? <Badge tone="accent">Retrying</Badge> : <Badge tone={TARGET_TONE[t.status]}>{TARGET_STATUS[t.status]}</Badge>}
        {t.scheduledAt && t.status !== 'draft' && <span className="text-xs text-muted">{shortDateTime(t.scheduledAt)}</span>}
        {removable && (
          <Button size="sm" variant="ghost" className="ml-auto" aria-label={`Remove the ${name} version`} onClick={onRemove}>
            <X size={14} />
          </Button>
        )}
      </div>
      <Field label={`${name} caption`}>{(id) => <Textarea id={id} rows={3} value={t.caption} readOnly={!editable} onChange={(e) => onChange({ caption: e.target.value })} />}</Field>
      <Field label={`${name} publish time`} hint={editable ? `Your time zone. At least ${MIN_LEAD_MINUTES} minutes ahead.` : undefined}>
        {(id) => <Input id={id} type="datetime-local" value={toLocalInput(t.scheduledAt)} readOnly={!editable} onChange={(e) => onChange({ scheduledAt: fromLocalInput(e.target.value) })} />}
      </Field>
      {/* A blocked approval stays visible until it is fixed, then clears itself. */}
      {((error && blocked) || t.error) && <Notice tone="danger">{(error && blocked) || t.error}</Notice>}
      {t.status === 'sent' && t.liveUrl && (
        <a className="text-sm text-accent underline" href={t.liveUrl} target="_blank" rel="noreferrer">
          Open the live {name} post
        </a>
      )}
      {t.status === 'sent' && t.metrics && <BufferMetrics m={t.metrics} />}
      <div className="flex flex-wrap gap-2">
        {editable &&
          (blocked ? (
            <Button size="sm" variant="primary" onClick={() => setError(blocked)}>
              {approveLabel}
            </Button>
          ) : (
            <ConfirmButton size="sm" variant="primary" message={`Publish this ${name} version through Buffer on ${shortDateTime(t.scheduledAt)}?`} onConfirm={() => { setError(null); onChange({ status: 'approved', error: '' }) }}>
              {approveLabel}
            </ConfirmButton>
          ))}
        {t.status === 'approved' && (
          <Button size="sm" onClick={() => onChange({ status: 'draft' })}>
            Unapprove
          </Button>
        )}
        {(t.status === 'approved' || t.status === 'scheduled' || (t.status === 'failed' && t.bufferPostId)) && (
          <ConfirmButton size="sm" variant="danger" message={`Cancel the ${name} version? It will not be published.`} onConfirm={() => onChange({ status: 'cancelled' })}>
            Cancel
          </ConfirmButton>
        )}
        {t.status === 'failed' && (
          <Button size="sm" onClick={() => onChange(t.bufferPostId ? { status: 'cancelled', retry: true, error: '' } : { status: 'draft', error: '' })}>
            Retry
          </Button>
        )}
        {t.status === 'cancelled' && !t.bufferPostId && (
          <Button size="sm" onClick={() => onChange({ status: 'draft', error: '' })}>
            Back to draft
          </Button>
        )}
      </div>
      {t.status === 'approved' && <p className="text-xs text-faint">The Buffer connector picks this up within 5 minutes.</p>}
      {t.status === 'failed' && t.bufferPostId && <p className="text-xs text-faint">Retry removes the failed post from Buffer and returns this version to draft, so you can pick a new time and approve it again.</p>}
      {t.status === 'cancelled' && t.bufferPostId && (
        <p className="text-xs text-faint">{t.retry ? 'Removing the failed post from Buffer within 5 minutes, then this version returns to draft.' : 'Removing it from Buffer within 5 minutes.'}</p>
      )}
    </div>
  )
}

/** Only the metrics Buffer reported, with when it measured them. Anything else is not shown, never shown as 0. */
function BufferMetrics({ m }: { m: TargetMetrics }) {
  if (!m.values.length) return <p className="text-xs text-faint">Buffer has no metrics for this post yet (checked {shortDateTime(m.readAt)}).</p>
  return (
    <div className="grid gap-1">
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {m.values.map((v) => (
          <div key={v.type} className="flex gap-1">
            <dt className="text-muted">{v.name}</dt>
            <dd>{v.unit === 'percentage' ? `${fmt(v.value)}%` : fmt(v.value, 0)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-faint">From Buffer, measured {shortDateTime(m.measuredAt)}.</p>
    </div>
  )
}

/** Every platform version on its way to Buffer or waiting on the creator, soonest first. */
export function BufferQueue({ onOpen }: { onOpen: (id: string) => void }) {
  const s = useAppState()
  const rows = s.content
    .flatMap((c) => (c.targets ?? []).filter((t) => t.status === 'approved' || t.status === 'scheduled' || t.status === 'failed').map((t) => ({ c, t })))
    .sort((a, b) => a.t.scheduledAt.localeCompare(b.t.scheduledAt))
  return (
    <Card className="mt-4">
      <CardTitle>Publishing through Buffer</CardTitle>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Approved platform versions show up here with their publish time, until they are live.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map(({ c, t }) => (
            <li key={`${c.id}-${t.platform}`} className="flex flex-wrap items-center gap-3">
              <Mono>{c.id}</Mono>
              <span className="w-16 text-xs">{PLATFORM[t.platform]}</span>
              <span className="w-28 text-xs text-muted">{shortDateTime(t.scheduledAt)}</span>
              <button className="min-w-0 flex-1 truncate text-left hover:text-accent" onClick={() => onOpen(c.id)}>
                {c.title || 'Untitled'}
              </button>
              <Badge tone={TARGET_TONE[t.status]}>{TARGET_STATUS[t.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
