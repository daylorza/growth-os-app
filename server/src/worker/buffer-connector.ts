/**
 * Buffer connector: the one publish path in Growth OS. It schedules a content item's platform version (target) in
 * Buffer only after the creator approved that version and its time, and deletes a Buffer post the creator cancelled.
 * It reads back what Buffer reports (sent with the live link, or failed with Buffer's reason, then post metrics).
 * It never replies, likes, follows or messages. ci/no-platform-writes.sh allows Buffer's API only in this file, and
 * test/draft-only.spec.ts pins the mutations it may send.
 *
 *   node dist/worker/buffer-connector.js channels   list the Buffer organization and channels (ids, names, services)
 *   node dist/worker/buffer-connector.js sync       schedule approved versions, delete cancelled ones, read back status and metrics
 *
 * Env: BUFFER_API_KEY (personal key, host only), BUFFER_ORGANIZATION_ID (optional: defaults to the only organization),
 * BUFFER_CHANNEL_TIKTOK / BUFFER_CHANNEL_THREADS / BUFFER_CHANNEL_X (optional: needed only when a platform has more
 * than one channel), GROWTH_OS_API (default http://127.0.0.1:8767), GROWTH_OS_CREATOR_KEY (sync only).
 * The key is never printed.
 */
import { TARGET_METRIC_UNITS, type ContentItem, type Platform, type PublishTarget, type TargetMetric } from '@growth-os/contracts'

const BUFFER_API = 'https://api.buffer.com'
/** Buffer's channel service for each Growth OS platform. */
export const SERVICE: Record<Platform, string> = { tiktok: 'tiktok', threads: 'threads', x: 'twitter' }
const IMAGE = /\.(jpe?g|png|gif|webp)(\?.*)?$/i

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export interface Channel {
  id: string
  name: string
  displayName?: string
  service: string
  isQueuePaused?: boolean
}

const env = (k: string) => {
  const v = process.env[k]?.trim()
  if (!v) throw new Error(`${k} is required.`)
  return v
}

async function json(res: Awaited<ReturnType<Fetch>>) {
  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { error: `HTTP ${res.status}` }
  }
}

// ---------- Buffer calls ----------

/** One GraphQL call. Throws Buffer's message, never the request (its header holds the key). */
export async function gql<T>(f: Fetch, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await f(BUFFER_API, { method: 'POST', headers: { authorization: `Bearer ${env('BUFFER_API_KEY')}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) })
  const b = await json(res)
  const errors = b.errors as { message?: string }[] | undefined
  if (errors?.length) throw new Error(`Buffer: ${errors.map((e) => e.message).join('; ')}`)
  if (!res.ok || !b.data) throw new Error(`Buffer: HTTP ${res.status}`)
  return b.data as T
}

export async function organizationId(f: Fetch) {
  const configured = process.env.BUFFER_ORGANIZATION_ID?.trim()
  if (configured) return configured
  const d = await gql<{ account: { organizations: { id: string; name: string }[] } }>(f, 'query Organizations { account { organizations { id name } } }')
  const orgs = d.account.organizations
  if (orgs.length !== 1) throw new Error(`Buffer has ${orgs.length} organizations. Set BUFFER_ORGANIZATION_ID to one of: ${orgs.map((o) => `${o.id} (${o.name})`).join(', ')}`)
  return orgs[0].id
}

export async function listChannels(f: Fetch, orgId: string) {
  const d = await gql<{ channels: Channel[] }>(f, 'query Channels($input: ChannelsInput!) { channels(input: $input) { id name displayName service isQueuePaused } }', { input: { organizationId: orgId } })
  return d.channels
}

/** The Buffer channel for each platform: the env override, else the only channel on that service. */
export function channelFor(platform: Platform, channels: Channel[]): { id: string } | { error: string } {
  const override = process.env[`BUFFER_CHANNEL_${platform.toUpperCase()}`]?.trim()
  if (override) return channels.some((c) => c.id === override) ? { id: override } : { error: `BUFFER_CHANNEL_${platform.toUpperCase()} is not a channel in this Buffer organization.` }
  const matches = channels.filter((c) => c.service === SERVICE[platform])
  if (matches.length === 1) return { id: matches[0].id }
  return { error: matches.length ? `Buffer has ${matches.length} ${SERVICE[platform]} channels. Set BUFFER_CHANNEL_${platform.toUpperCase()}.` : `No ${SERVICE[platform]} channel is connected in Buffer.` }
}

/** createPost input for one approved version: Buffer publishes it itself at the approved time. */
export function postInput(t: PublishTarget, mediaUrl: string, channelId: string) {
  const asset = mediaUrl ? [IMAGE.test(mediaUrl) ? { image: { url: mediaUrl } } : { video: { url: mediaUrl } }] : []
  return { text: t.caption, channelId, schedulingType: 'automatic', mode: 'customScheduled', dueAt: new Date(t.scheduledAt).toISOString(), assets: asset }
}

type PostResult = { id?: string; message?: string }

export async function createPost(f: Fetch, input: ReturnType<typeof postInput>): Promise<PostResult> {
  const d = await gql<{ createPost: { post?: { id: string }; message?: string } }>(
    f,
    'mutation CreatePost($input: CreatePostInput!) { createPost(input: $input) { ... on PostActionSuccess { post { id dueAt } } ... on MutationError { message } } }',
    { input },
  )
  return d.createPost.post ? { id: d.createPost.post.id } : { message: d.createPost.message ?? 'Buffer did not schedule it.' }
}

export async function deletePost(f: Fetch, id: string): Promise<PostResult> {
  const d = await gql<{ deletePost: { id?: string; message?: string } }>(
    f,
    'mutation DeletePost($input: DeletePostInput!) { deletePost(input: $input) { ... on DeletePostSuccess { id } ... on VoidMutationError { message } } }',
    { input: { id } },
  )
  return d.deletePost.id ? { id: d.deletePost.id } : { message: d.deletePost.message ?? 'Buffer did not delete it.' }
}

/** One Buffer post as Buffer reports it (field names from Buffer's Post type). */
export interface BufferPost {
  id: string
  /** draft | needs_approval | scheduled | sending | sent | error */
  status: string
  externalLink?: string | null
  error?: { message?: string } | null
  /** Null until the post is sent and Buffer's daily job has read the platform. */
  metrics?: TargetMetric[] | null
  metricsUpdatedAt?: string | null
}

export async function readPost(f: Fetch, id: string) {
  const d = await gql<{ post: BufferPost }>(
    f,
    'query Post($input: PostInput!) { post(input: $input) { id status externalLink error { message } metrics { type name value unit } metricsUpdatedAt } }',
    { input: { id } },
  )
  return d.post
}

const HOUR = 3_600_000
/** Buffer refreshes metrics once a day: read a sent post from a day after its time, twice a day, for 30 days. */
const METRICS_FROM = 24 * HOUR
const METRICS_UNTIL = 30 * 24 * HOUR
const METRICS_EVERY = 12 * HOUR

/** Whether this version needs a Buffer read: scheduled and due, or sent and missing its link or due a metrics read. */
export function needsRead(t: PublishTarget, now: number) {
  if (!t.bufferPostId) return false
  const age = now - Date.parse(t.scheduledAt)
  if (t.status === 'scheduled') return age >= 0
  if (t.status !== 'sent' || age > METRICS_UNTIL) return false
  if (!t.liveUrl) return true
  return age >= METRICS_FROM && !(t.metrics && now - Date.parse(t.metrics.readAt) < METRICS_EVERY)
}

/** What Buffer reports for one scheduled or sent version, as changes to record; null when there is nothing new. */
export function readChanges(t: PublishTarget, p: BufferPost, now: number): Partial<PublishTarget> | null {
  if (t.status === 'scheduled' && p.status === 'error') return { status: 'failed', error: `Buffer could not publish it: ${p.error?.message?.trim() || 'Buffer gave no reason.'}` }
  if (p.status !== 'sent') return null
  const changes: Partial<PublishTarget> = t.status === 'scheduled' ? { status: 'sent', error: '' } : {}
  const link = p.externalLink?.trim() ?? ''
  if (!t.liveUrl && /^https:\/\/\S+$/.test(link)) changes.liveUrl = link
  if (now - Date.parse(t.scheduledAt) >= METRICS_FROM) {
    // Only what Buffer reported, as Buffer reported it. A metric it did not report stays absent, never 0.
    const values = (p.metrics ?? [])
      .filter((m) => typeof m?.type === 'string' && typeof m.value === 'number' && Number.isFinite(m.value) && m.value >= 0 && (TARGET_METRIC_UNITS as readonly string[]).includes(m.unit))
      .map(({ type, name, value, unit }) => ({ type, name: name || type, value, unit }))
    changes.metrics = { source: 'buffer', measuredAt: p.metricsUpdatedAt ?? '', readAt: new Date(now).toISOString(), values }
  }
  return Object.keys(changes).length ? changes : null
}

// ---------- Growth OS calls ----------

async function api(f: Fetch, path: string, init: { method?: string; body?: unknown } = {}) {
  const base = (process.env.GROWTH_OS_API ?? 'http://127.0.0.1:8767').replace(/\/$/, '')
  return f(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${env('GROWTH_OS_CREATOR_KEY')}`, 'content-type': 'application/json', 'x-growth-source': 'buffer connector' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

/**
 * Writes one version's new publishing state onto the item as it is now, so an edit made while this ran is kept.
 * Skipped when the version moved on since it was read.
 */
async function record(f: Fetch, itemId: string, platform: Platform, expected: PublishTarget['status'], changes: Partial<PublishTarget>) {
  const res = await api(f, `/api/content/${encodeURIComponent(itemId)}`)
  if (!res.ok) return `could not read ${itemId}: HTTP ${res.status}`
  const item = (await json(res)) as unknown as ContentItem
  const current = (item.targets ?? []).find((t) => t.platform === platform)
  if (!current || current.status !== expected) return `${itemId} ${platform} changed while syncing; left as is`
  const targets = (item.targets ?? []).map((t) => (t.platform === platform ? { ...t, ...changes } : t))
  const r = await api(f, `/api/content/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: { targets } })
  return r.ok ? null : `could not save ${itemId} ${platform}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`
}

export interface SyncResult {
  scheduled: string[]
  cancelled: string[]
  failed: string[]
  sent: string[]
  measured: string[]
  problems: string[]
}

export async function sync(f: Fetch = fetch as unknown as Fetch, now = Date.now()): Promise<SyncResult> {
  const out: SyncResult = { scheduled: [], cancelled: [], failed: [], sent: [], measured: [], problems: [] }
  const res = await api(f, '/api/content-items')
  if (!res.ok) throw new Error(`Could not read content items: HTTP ${res.status}`)
  const items = (await json(res)) as unknown as ContentItem[]
  const work = (Array.isArray(items) ? items : []).flatMap((c) =>
    (c.targets ?? []).filter((t) => (t.status === 'approved' && !t.bufferPostId) || (t.status === 'cancelled' && t.bufferPostId) || needsRead(t, now)).map((t) => ({ c, t })),
  )
  let channels: Channel[] | null = null

  for (const { c, t } of work) {
    const label = `${c.id} ${t.platform}`
    const note = (p: string | null) => p && out.problems.push(p)
    if (t.status === 'scheduled' || t.status === 'sent') {
      const post = await readPost(f, t.bufferPostId).catch((e: Error) => e)
      if (post instanceof Error) {
        out.problems.push(`${label}: could not read Buffer post ${t.bufferPostId}: ${post.message}`)
        continue
      }
      const changes = readChanges(t, post, now)
      if (!changes) continue
      const saved = await record(f, c.id, t.platform, t.status, changes)
      if (saved) {
        out.problems.push(saved)
        continue
      }
      if (changes.status === 'failed') out.failed.push(label)
      if (changes.status === 'sent') out.sent.push(label)
      if (changes.metrics) out.measured.push(label)
      continue
    }
    if (t.status === 'cancelled') {
      const r = await deletePost(f, t.bufferPostId)
      if (r.id) {
        note(await record(f, c.id, t.platform, 'cancelled', { bufferPostId: '', error: '' }))
        out.cancelled.push(label)
      } else note(await record(f, c.id, t.platform, 'cancelled', { error: `Buffer did not delete it: ${r.message}` }))
      continue
    }
    const fail = async (error: string) => {
      note(await record(f, c.id, t.platform, 'approved', { status: 'failed', error }))
      out.failed.push(label)
    }
    if (Date.parse(t.scheduledAt) <= now + 60_000) {
      await fail('The approved time passed before it reached Buffer. Pick a new time and approve again.')
      continue
    }
    channels ??= await listChannels(f, await organizationId(f))
    const channel = channelFor(t.platform, channels)
    if ('error' in channel) {
      await fail(channel.error)
      continue
    }
    const r = await createPost(f, postInput(t, c.mediaUrl ?? '', channel.id))
    if (!r.id) {
      await fail(`Buffer did not schedule it: ${r.message}`)
      continue
    }
    const saved = await record(f, c.id, t.platform, 'approved', { status: 'scheduled', bufferPostId: r.id, error: '' })
    // Buffer holds the post but Growth OS could not record it: say so loudly, so it is not scheduled twice by hand.
    if (saved) out.problems.push(`${saved}. Buffer post ${r.id} exists; check Buffer before approving again.`)
    out.scheduled.push(label)
  }
  return out
}

if (require.main === module) {
  const mode = process.argv[2]
  const f = fetch as unknown as Fetch
  const run =
    mode === 'channels' ? organizationId(f).then(async (org) => ({ organizationId: org, channels: await listChannels(f, org) }))
    : mode === 'sync' ? sync(f)
    : null
  if (!run) {
    console.error('Usage: buffer-connector channels|sync')
    process.exit(1)
  }
  run.then(
    (r) => {
      console.log(JSON.stringify(r))
      if ('problems' in r && r.problems.length) process.exitCode = 1
    },
    (e: Error) => {
      console.error(e.message)
      process.exit(1)
    },
  )
}
