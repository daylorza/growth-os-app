/**
 * Read-only Threads connector for the creator's own account. It reads replies to her recent posts and queues new ones
 * in the Engagement Hub as drafts. It never posts, replies, hides, likes, follows or messages: the only Threads calls are
 * the OAuth token endpoints, her own post list (`/me/threads`) and each post's replies (`/{id}/conversation`).
 * Scopes: threads_basic and threads_read_replies only. ci/no-platform-writes.sh and test/draft-only.spec.ts allow this
 * file, and only these Threads paths.
 *
 *   node dist/worker/threads-connector.js serve   127.0.0.1 page: /start sends the creator to Threads, /callback stores the token
 *   node dist/worker/threads-connector.js pull    refresh the token when due, queue new replies to recent posts
 *
 * Env: THREADS_APP_ID, THREADS_APP_SECRET, THREADS_REDIRECT_URI (registered in the Meta app),
 * THREADS_TOKEN_FILE (default /var/lib/growth-os/threads/token.json), THREADS_CONNECTOR_PORT (default 8769),
 * THREADS_LOOKBACK_DAYS (default 7), GROWTH_OS_API (default http://127.0.0.1:8767), GROWTH_OS_CREATOR_KEY (pull only).
 * Secrets and tokens are never printed.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname } from 'node:path'

export const THREADS = {
  authorize: 'https://threads.com/oauth/authorize',
  token: 'https://graph.threads.com/oauth/access_token',
  longLived: 'https://graph.threads.com/access_token',
  refresh: 'https://graph.threads.com/refresh_access_token',
  myPosts: 'https://graph.threads.com/v1.0/me/threads',
  /** Media node prefix: only `${media}<post id>/conversation` is read. */
  media: 'https://graph.threads.com/v1.0/',
} as const
export const SCOPES = ['threads_basic', 'threads_read_replies']
const POST_FIELDS = 'id,permalink,username,timestamp'
const REPLY_FIELDS = 'id,text,username,permalink,timestamp,replied_to,is_reply_owned_by_me,hide_status'
/** Hidden or restricted replies are left out: the creator (or Threads) already dealt with them. */
const SKIP_HIDE = new Set(['HIDDEN', 'BLOCKED', 'RESTRICTED'])
const MAX_POST_PAGES = 4
const MAX_REPLY_PAGES = 5
const DAY = 86_400_000
/** Marks queue items this connector added; the engagement sweep reads it to skip Threads replies. */
export const NOTE_PREFIX = 'From the Threads connector'

export interface Token {
  accessToken: string
  userId: string
  /** Epoch ms. */
  expiresAt: number
  /** Epoch ms: a long-lived token can be refreshed once it is 24 hours old. */
  issuedAt: number
}

export interface ThreadsPost {
  id: string
  permalink?: string
  username?: string
  timestamp?: string
}

export interface ThreadsReply {
  id: string
  text?: string
  username?: string
  permalink?: string
  timestamp?: string
  replied_to?: { id: string }
  is_reply_owned_by_me?: boolean
  hide_status?: string
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export function authorizeUrl(appId: string, redirectUri: string, state: string) {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, scope: SCOPES.join(','), response_type: 'code', state })
  return `${THREADS.authorize}?${q}`
}

/** Threads' error message, never the request (its URL can hold the secret or token). */
function threadsError(b: Record<string, unknown>) {
  const e = b.error as { message?: string; code?: number } | undefined
  if (e?.message) return `Threads: ${e.message}`
  if (typeof b.error_message === 'string') return `Threads: ${b.error_message}`
  return null
}

/** Long-lived token response → stored token. */
export function parseToken(body: Record<string, unknown>, userId: string, now = Date.now()): Token {
  if (typeof body.access_token !== 'string') throw new Error(threadsError(body) ?? 'Threads: no token in the response.')
  return { accessToken: body.access_token, userId, expiresAt: now + Number(body.expires_in ?? 0) * 1000, issuedAt: now }
}

// ---------- storage ----------

const tokenFile = () => process.env.THREADS_TOKEN_FILE || '/var/lib/growth-os/threads/token.json'

export function readToken(file = tokenFile()): Token | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Token
  } catch {
    return null
  }
}

export function writeToken(t: Token, file = tokenFile()) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(t), { mode: 0o600 })
  renameSync(tmp, file)
}

// ---------- Threads calls ----------

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
    return { error: { message: `HTTP ${res.status}` } }
  }
}

async function get(f: Fetch, url: string, params: Record<string, string>) {
  const b = await json(await f(`${url}?${new URLSearchParams(params)}`))
  const err = threadsError(b)
  if (err) throw new Error(err)
  return b
}

/** Authorization code → short-lived token → long-lived token (60 days). */
export async function exchangeCode(f: Fetch, code: string, now = Date.now()) {
  const body = new URLSearchParams({ client_id: env('THREADS_APP_ID'), client_secret: env('THREADS_APP_SECRET'), grant_type: 'authorization_code', redirect_uri: env('THREADS_REDIRECT_URI'), code })
  const short = await json(await f(THREADS.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }))
  if (typeof short.access_token !== 'string') throw new Error(threadsError(short) ?? 'Threads: no token in the response.')
  const long = await get(f, THREADS.longLived, { grant_type: 'th_exchange_token', client_secret: env('THREADS_APP_SECRET'), access_token: short.access_token })
  return parseToken(long, String(short.user_id ?? ''), now)
}

/** Refreshes a long-lived token with under 30 days left once it is a day old; saved every time. */
export async function freshToken(f: Fetch, current: Token, save: (t: Token) => void, now = Date.now()) {
  if (current.expiresAt <= now) throw new Error('The Threads authorization expired. Open the connector /start page to authorize again.')
  if (current.expiresAt - now > 30 * DAY || now - current.issuedAt < DAY) return current
  const next = parseToken(await get(f, THREADS.refresh, { grant_type: 'th_refresh_token', access_token: current.accessToken }), current.userId, now)
  save(next)
  return next
}

type Page<T> = { data?: T[]; paging?: { cursors?: { after?: string }; next?: string } }

async function pages<T>(f: Fetch, url: string, params: Record<string, string>, max: number) {
  const out: T[] = []
  let after: string | undefined
  for (let i = 0; i < max; i++) {
    const b = (await get(f, url, after ? { ...params, after } : params)) as Page<T>
    out.push(...(b.data ?? []))
    after = b.paging?.cursors?.after
    if (!b.paging?.next || !after || !b.data?.length) break
  }
  return out
}

/** The creator's own posts from the last `days` days. */
export const listPosts = (f: Fetch, accessToken: string, since: number) =>
  pages<ThreadsPost>(f, THREADS.myPosts, { fields: POST_FIELDS, since: String(Math.floor(since / 1000)), limit: '25', access_token: accessToken }, MAX_POST_PAGES)

/** Every reply under one of her posts, at any depth. */
export const listReplies = (f: Fetch, accessToken: string, postId: string) =>
  pages<ThreadsReply>(f, `${THREADS.media}${encodeURIComponent(postId)}/conversation`, { fields: REPLY_FIELDS, reverse: 'false', access_token: accessToken }, MAX_REPLY_PAGES)

// ---------- queue items ----------

interface QueueItem {
  platform?: string
  sourcePost?: string
  author?: string
  comment?: string
  note?: string
}

const marker = (replyId: string) => `(reply ${replyId})`
const handle = (u?: string) => (u ? `@${u.replace(/^@/, '')}` : '')

/**
 * New replies under one post as engagement drafts. Her own replies are not queued; a reply she already answered is
 * queued as dismissed, so nobody answers it twice. Anything already in the queue (same reply, link, or author and
 * text from the agent's sweep) is skipped.
 */
export function queueItems(post: ThreadsPost, replies: ThreadsReply[], existing: QueueItem[], now = Date.now()) {
  const answered = new Map<string, string>()
  for (const r of replies) if (r.is_reply_owned_by_me && r.replied_to?.id) answered.set(r.replied_to.id, r.timestamp ?? '')
  const seen = (r: ThreadsReply) =>
    existing.some(
      (e) =>
        e.note?.includes(marker(r.id)) ||
        (!!r.permalink && e.sourcePost === r.permalink) ||
        (e.platform === 'threads' && !!r.text && e.comment?.trim() === r.text.trim() && e.author?.replace(/^@/, '').toLowerCase() === (r.username ?? '').toLowerCase()),
    )
  const today = new Date(now).toISOString().slice(0, 10)
  return replies
    .filter((r) => !r.is_reply_owned_by_me && !SKIP_HIDE.has(r.hide_status ?? '') && (r.text ?? '').trim() && !seen(r))
    .map((r) => {
      const replied = answered.get(r.id)
      return {
        platform: 'threads' as const,
        account: handle(post.username),
        sourcePost: r.permalink || post.permalink || '',
        author: handle(r.username) || 'UNKNOWN',
        comment: r.text!.trim(),
        channel: 'comment' as const,
        ...(replied !== undefined ? { status: 'dismissed' as const } : {}),
        note: [`${NOTE_PREFIX} ${marker(r.id)}, ${today}.`, replied !== undefined ? `Already replied by the creator, ${replied.slice(0, 10) || 'date unknown'}.` : ''].filter(Boolean).join(' '),
      }
    })
}

// ---------- Growth OS calls ----------

async function api(f: Fetch, path: string, init: { method?: string; body?: unknown } = {}) {
  const base = (process.env.GROWTH_OS_API ?? 'http://127.0.0.1:8767').replace(/\/$/, '')
  return f(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${env('GROWTH_OS_CREATOR_KEY')}`, 'content-type': 'application/json', 'x-growth-source': 'threads connector' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

export async function pull(f: Fetch = fetch as unknown as Fetch, now = Date.now()) {
  const stored = readToken()
  if (!stored) throw new Error('No Threads authorization yet. Open the connector /start page first.')
  const token = await freshToken(f, stored, (t) => writeToken(t), now)
  const days = Math.max(1, Number(process.env.THREADS_LOOKBACK_DAYS) || 7)
  const posts = await listPosts(f, token.accessToken, now - days * DAY)
  const q = await api(f, '/api/engagement-queue')
  if (!q.ok) throw new Error(`Could not read the engagement queue: HTTP ${q.status}`)
  const existing = (await json(q)) as unknown as QueueItem[]
  const known: QueueItem[] = Array.isArray(existing) ? [...existing] : []
  const out = { posts: posts.length, replies: 0, queued: 0, alreadyAnswered: 0, problems: [] as string[] }
  for (const post of posts) {
    const replies = await listReplies(f, token.accessToken, post.id).catch((e: Error) => e)
    if (replies instanceof Error) {
      out.problems.push(`post ${post.id}: ${replies.message}`)
      continue
    }
    out.replies += replies.length
    for (const item of queueItems(post, replies, known, now)) {
      const r = await api(f, '/api/engagement-queue', { method: 'POST', body: item })
      if (!r.ok) {
        out.problems.push(`post ${post.id}: could not queue a reply: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
        continue
      }
      known.push(item)
      out.queued++
      if (item.status === 'dismissed') out.alreadyAnswered++
    }
  }
  return out
}

// ---------- authorization page ----------

export function serve(f: Fetch = fetch as unknown as Fetch) {
  const port = Number(process.env.THREADS_CONNECTOR_PORT ?? 8769)
  const states = new Map<string, number>()
  const page = (res: import('node:http').ServerResponse, status: number, text: string, location?: string) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...(location ? { location } : {}) })
    res.end(text)
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/\/+$/, '')
    if (req.method !== 'GET') return page(res, 405, 'GET only.')
    if (path.endsWith('/start')) {
      const state = randomBytes(24).toString('hex')
      states.set(state, Date.now() + 10 * 60_000)
      return page(res, 302, 'Redirecting to Threads.', authorizeUrl(env('THREADS_APP_ID'), env('THREADS_REDIRECT_URI'), state))
    }
    if (path.endsWith('/callback')) {
      const state = url.searchParams.get('state') ?? ''
      const expires = states.get(state)
      states.delete(state)
      if (!expires || expires < Date.now()) return page(res, 400, 'This sign-in link expired or did not start here. Open /start again.')
      if (url.searchParams.get('error')) return page(res, 400, `Threads said: ${url.searchParams.get('error')}. Nothing was stored.`)
      // Threads appends "#_" to the redirect; browsers keep fragments out of the request, but strip it if present.
      const code = url.searchParams.get('code')?.replace(/#_$/, '')
      if (!code) return page(res, 400, 'No authorization code. Nothing was stored.')
      exchangeCode(f, code).then(
        (t) => {
          writeToken(t)
          page(res, 200, 'Threads connected (read-only: threads_basic, threads_read_replies). The pull will use it. You can close this tab.')
        },
        (e: Error) => page(res, 502, e.message),
      )
      return
    }
    page(res, 404, 'Open /start to connect Threads.')
  })
  server.listen(port, '127.0.0.1', () => console.log(`Threads connector on http://127.0.0.1:${port} (read-only)`))
  return server
}

if (require.main === module) {
  const mode = process.argv[2]
  if (mode === 'serve') serve()
  else if (mode === 'pull')
    pull().then(
      (r) => {
        console.log(JSON.stringify(r))
        if (r.problems.length) process.exitCode = 1
      },
      (e: Error) => {
        console.error(e.message)
        process.exit(1)
      },
    )
  else {
    console.error('Usage: threads-connector serve|pull')
    process.exit(1)
  }
}
