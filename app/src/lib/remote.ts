/**
 * Mapping between the dashboard's state and the Growth OS API, plus the diff that turns a local edit
 * into REST calls. The API is the source of truth whenever it is configured.
 */
import type { Handoff as ApiHandoff } from '@growth-os/contracts'
import type { PrivateData } from './private'
import type { TikTokSnapshot } from './tiktok'
import type { AppState, BriefField, BriefKey, CollectionKey, FollowerSnapshot, Handoff, Profile } from './types'

type Metric = number | 'UNKNOWN'

export interface WriteMeta {
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  updatedSource: string
}

export interface ServerSnapshot {
  id: string
  platform: FollowerSnapshot['platform']
  date: string
  source: string
  sourceType: string
  metrics: Record<'followers' | 'following' | 'posts' | 'views7d' | 'views14d' | 'views28d' | 'engagementRate', Metric>
  verified: boolean
  demo?: boolean
}

type Collections = Omit<Pick<AppState, CollectionKey>, 'snapshots' | 'handoffs'>

export interface EndpointState extends Collections {
  initialized: boolean
  profile: (Profile & { masterPrompt?: string }) | null
  brief: Record<BriefKey, BriefField & { source?: string }>
  settings: AppState['settings'] | null
  snapshots: ServerSnapshot[]
  handoffs: ApiHandoff[]
  tiktokVault: TikTokSnapshot | null
}

/** Dashboard follower snapshots are the subset with an observed follower count. Other metrics stay on the server. */
export const toFollowerSnapshot = (s: ServerSnapshot): FollowerSnapshot | null =>
  typeof s.metrics.followers === 'number'
    ? { id: s.id, platform: s.platform, date: s.date, count: s.metrics.followers, source: s.source, verified: s.verified, ...(s.demo ? { demo: true } : {}) }
    : null

/** The API's handoff (contentItemId, body, acknowledgedAt) as the dashboard's log entry. */
export const toDashboardHandoff = (h: ApiHandoff): Handoff => ({
  id: h.id,
  from: h.from,
  to: h.to,
  itemId: h.contentItemId,
  message: h.body,
  createdAt: h.createdAt,
  acknowledged: !!h.acknowledgedAt,
  type: h.type,
  ...(h.refs?.length ? { refs: h.refs.map((r) => ({ collection: r.collection, id: r.id })) } : {}),
  ...(h.demo ? { demo: true } : {}),
  ...(h._meta ? { _meta: h._meta } : {}),
})

export function fromEndpoint(s: EndpointState, base: AppState): { state: AppState; private: PrivateData } {
  const { masterPrompt, ...profile }: Profile & { masterPrompt?: string } = s.profile ?? base.profile
  return {
    state: {
      ...base,
      profile: profile as Profile,
      brief: { ...base.brief, ...s.brief },
      settings: s.settings ?? base.settings,
      content: s.content,
      engagements: s.engagements,
      keywords: s.keywords,
      resources: s.resources ?? [],
      snapshots: s.snapshots.map(toFollowerSnapshot).filter((x): x is FollowerSnapshot => !!x),
      experiments: s.experiments,
      reports: s.reports,
      leads: s.leads,
      tasks: s.tasks,
      checkins: s.checkins,
      handoffs: s.handoffs.map(toDashboardHandoff),
    },
    private: { tiktok: s.tiktokVault ?? undefined, masterPrompt },
  }
}

export const ENDPOINTS: Record<CollectionKey, string> = {
  content: '/api/content',
  engagements: '/api/engagement-queue',
  keywords: '/api/keywords',
  resources: '/api/resources',
  snapshots: '/api/audience/snapshots',
  experiments: '/api/experiments',
  reports: '/api/reports',
  leads: '/api/leads',
  tasks: '/api/tasks',
  checkins: '/api/checkins',
  handoffs: '/api/handoffs',
}

export interface Op {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const strip = (item: object) => {
  const { _meta: _m, ...rest } = item as Record<string, unknown>
  return rest
}

const createBody = (key: CollectionKey, item: object) => {
  if (key === 'handoffs') {
    const h = item as Handoff
    return { id: h.id, contentItemId: h.itemId, from: h.from, to: h.to, type: h.type ?? 'question', body: h.message, refs: h.refs ?? [], createdAt: h.createdAt, ...(h.demo ? { demo: true } : {}) }
  }
  if (key !== 'snapshots') return strip(item)
  const s = item as FollowerSnapshot
  return { id: s.id, platform: s.platform, date: s.date, source: s.source || 'Manual', sourceType: 'manual', metrics: { followers: s.count }, verified: s.verified, ...(s.demo ? { demo: true } : {}) }
}

/** REST calls that turn `prev` into `next`. Only changed fields are sent. */
export function diff(prev: AppState, next: AppState): Op[] {
  const ops: Op[] = []
  if (!same(prev.profile, next.profile)) ops.push({ method: 'PUT', path: '/api/profile', body: next.profile })
  const fields = (Object.keys(next.brief) as BriefKey[]).filter((k) => !same(prev.brief[k], next.brief[k])).map((key) => ({ key, value: next.brief[key].value, verified: next.brief[key].verified }))
  if (fields.length) ops.push({ method: 'PATCH', path: '/api/brief', body: { fields } })
  if (!same(prev.settings, next.settings)) ops.push({ method: 'PUT', path: '/api/settings', body: next.settings })

  for (const key of Object.keys(ENDPOINTS) as CollectionKey[]) {
    if (prev[key] === next[key]) continue
    const path = ENDPOINTS[key]
    const before = new Map((prev[key] as { id: string }[]).map((i) => [i.id, i as Record<string, unknown>]))
    const after = new Map((next[key] as { id: string }[]).map((i) => [i.id, i as Record<string, unknown>]))
    for (const [id, item] of after) {
      const old = before.get(id)
      if (!old) ops.push({ method: 'POST', path, body: createBody(key, item) })
      else if (!same(strip(old), strip(item))) {
        if (key === 'snapshots') continue // snapshots are immutable evidence: delete and re-add instead
        // Handoffs are a log: the only change is the recipient acknowledging it.
        if (key === 'handoffs') {
          if (item.acknowledged && !old.acknowledged) ops.push({ method: 'POST', path: `${path}/${encodeURIComponent(id)}/ack` })
          continue
        }
        const changes = Object.fromEntries(Object.entries(strip(item)).filter(([k, v]) => k !== 'id' && !same(old[k], v)))
        if (Object.keys(changes).length) ops.push({ method: 'PATCH', path: `${path}/${encodeURIComponent(id)}`, body: changes })
      }
    }
    for (const id of before.keys()) if (!after.has(id) && key !== 'handoffs') ops.push({ method: 'DELETE', path: `${path}/${encodeURIComponent(id)}` })
  }
  return ops
}

/** The login expired or was revoked: go to the in-app sign-in page, then come back here. */
export function signInAgainIf401(res: Response) {
  if (res.status !== 401 || typeof window === 'undefined') return
  const here = `${window.location.pathname}${window.location.search}`
  window.location.assign(here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`)
}

export async function send(op: Op): Promise<void> {
  const res = await fetch(op.path, {
    method: op.method,
    headers: { 'content-type': 'application/json', 'x-growth-client': 'dashboard', 'x-growth-source': 'dashboard' },
    body: op.body === undefined ? undefined : JSON.stringify(op.body),
  })
  signInAgainIf401(res)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null
    const msg = Array.isArray(body?.message) ? body.message.join('; ') : body?.message
    throw new Error(msg || `${op.method} ${op.path} failed (${res.status})`)
  }
}

export async function fetchState(): Promise<EndpointState> {
  const res = await fetch('/api/state', { headers: { 'x-growth-client': 'dashboard' }, cache: 'no-store' })
  signInAgainIf401(res)
  if (!res.ok) throw new Error(`Could not load from the endpoint (${res.status}).`)
  return (await res.json()) as EndpointState
}
