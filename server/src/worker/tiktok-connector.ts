/**
 * Read-only TikTok connector (Login Kit + Display API) for the creator's own account. It never posts, uploads,
 * comments, likes, follows or messages: the only TikTok calls are the OAuth token exchange and Display API reads (user info, video list).
 * ci/no-platform-writes.sh and test/draft-only.spec.ts allow this file, and only these TikTok paths.
 *
 *   node dist/worker/tiktok-connector.js serve   127.0.0.1 page: /start sends the creator to TikTok, /callback stores the token
 *   node dist/worker/tiktok-connector.js pull    refresh the token, write today's TikTok snapshot and update content metrics
 *
 * Env: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI (registered in the TikTok app),
 * TIKTOK_TOKEN_FILE (default /var/lib/growth-os/tiktok/token.json), TIKTOK_CONNECTOR_PORT (default 8768),
 * GROWTH_OS_API (default http://127.0.0.1:8767), GROWTH_OS_CREATOR_KEY (pull only). Secrets are never printed.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname } from 'node:path'

export const TIKTOK = {
  authorize: 'https://www.tiktok.com/v2/auth/authorize/',
  token: 'https://open.tiktokapis.com/v2/oauth/token/',
  userInfo: 'https://open.tiktokapis.com/v2/user/info/',
  videoList: 'https://open.tiktokapis.com/v2/video/list/',
} as const
export const SCOPES = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list']
const USER_FIELDS = 'open_id,username,display_name,follower_count,following_count,likes_count,video_count'
const VIDEO_FIELDS = 'id,title,create_time,share_url,view_count,like_count,comment_count,share_count'
/** 20 videos a page: up to 400 of the newest public videos per daily pull. */
const MAX_PAGES = 20

export interface Token {
  accessToken: string
  refreshToken: string
  openId: string
  scope: string
  /** Epoch ms. */
  expiresAt: number
  refreshExpiresAt: number
}

export interface TikTokUser {
  username?: string
  follower_count?: number
  following_count?: number
  likes_count?: number
  video_count?: number
}

export interface TikTokVideo {
  id: string
  share_url?: string
  view_count?: number
  like_count?: number
  comment_count?: number
  share_count?: number
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)

export function authorizeUrl(clientKey: string, redirectUri: string, state: string) {
  const q = new URLSearchParams({ client_key: clientKey, response_type: 'code', scope: SCOPES.join(','), redirect_uri: redirectUri, state })
  return `${TIKTOK.authorize}?${q}`
}

/** Token response → stored token. Throws TikTok's error code, never the request (it holds the secret). */
export function parseToken(body: unknown, now = Date.now()): Token {
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.access_token !== 'string' || typeof b.refresh_token !== 'string') throw new Error(`TikTok token error: ${String(b.error ?? 'no token')} ${String(b.error_description ?? '')}`.trim())
  return {
    accessToken: b.access_token,
    refreshToken: b.refresh_token,
    openId: String(b.open_id ?? ''),
    scope: String(b.scope ?? ''),
    expiresAt: now + Number(b.expires_in ?? 0) * 1000,
    refreshExpiresAt: now + Number(b.refresh_expires_in ?? 0) * 1000,
  }
}

/** Today's account snapshot. Counts TikTok did not return stay UNKNOWN (omitted), never 0. */
export function snapshotFrom(user: TikTokUser, date: string) {
  const metrics: Record<string, number> = {}
  const set = (k: string, v: unknown) => {
    const n = num(v)
    if (n !== undefined) metrics[k] = n
  }
  set('followers', user.follower_count)
  set('following', user.following_count)
  set('posts', user.video_count)
  return { id: `S-TT-API-${date}`, platform: 'tiktok', date, source: 'TikTok Display API (user.info.stats)', sourceType: 'platform_api', verified: true, metrics }
}

/** The TikTok video id in a content item's URL (…/video/<id>). */
export const videoIdFromUrl = (url: string) => /\/video\/(\d+)/.exec(url)?.[1] ?? null

/** New metrics for a content item: existing fields kept, the API's counts on top. */
export function contentMetricsFrom(v: TikTokVideo, existing: Record<string, unknown>, at: string) {
  const next: Record<string, unknown> = { ...existing, measuredAt: at, source: 'TikTok Display API (video.list)' }
  for (const [k, field] of [['views', 'view_count'], ['comments', 'comment_count'], ['shares', 'share_count']] as const) {
    const n = num(v[field])
    if (n !== undefined) next[k] = n
  }
  return next
}

// ---------- storage ----------

const tokenFile = () => process.env.TIKTOK_TOKEN_FILE || '/var/lib/growth-os/tiktok/token.json'

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

// ---------- TikTok calls ----------

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

async function tokenRequest(f: Fetch, params: Record<string, string>) {
  const body = new URLSearchParams({ client_key: env('TIKTOK_CLIENT_KEY'), client_secret: env('TIKTOK_CLIENT_SECRET'), ...params })
  const res = await f(TIKTOK.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() })
  return parseToken(await json(res))
}

export const exchangeCode = (f: Fetch, code: string) => tokenRequest(f, { code, grant_type: 'authorization_code', redirect_uri: env('TIKTOK_REDIRECT_URI') })

/** A usable access token. Refreshes when it expires within 10 minutes; TikTok rotates the refresh token, so it is saved every time. */
export async function freshToken(f: Fetch, current: Token, save: (t: Token) => void, now = Date.now()) {
  if (current.expiresAt - now > 10 * 60_000) return current
  if (current.refreshExpiresAt <= now) throw new Error('The TikTok authorization expired. Open the connector /start page to authorize again.')
  const next = await tokenRequest(f, { grant_type: 'refresh_token', refresh_token: current.refreshToken })
  save(next)
  return next
}

function tiktokError(b: Record<string, unknown>) {
  const e = b.error as { code?: string; message?: string } | undefined
  return e && e.code && e.code !== 'ok' ? `TikTok ${e.code}: ${e.message ?? ''}`.trim() : null
}

export async function getUser(f: Fetch, accessToken: string): Promise<TikTokUser> {
  const b = await json(await f(`${TIKTOK.userInfo}?fields=${USER_FIELDS}`, { headers: { authorization: `Bearer ${accessToken}` } }))
  const err = tiktokError(b)
  if (err) throw new Error(err)
  return ((b.data as { user?: TikTokUser } | undefined)?.user ?? {}) as TikTokUser
}

export async function listVideos(f: Fetch, accessToken: string): Promise<TikTokVideo[]> {
  const out: TikTokVideo[] = []
  let cursor: number | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await f(`${TIKTOK.videoList}?fields=${VIDEO_FIELDS}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(cursor ? { max_count: 20, cursor } : { max_count: 20 }),
    })
    const b = await json(res)
    const err = tiktokError(b)
    if (err) throw new Error(err)
    const d = (b.data ?? {}) as { videos?: TikTokVideo[]; has_more?: boolean; cursor?: number }
    out.push(...(d.videos ?? []))
    if (!d.has_more || !d.cursor) break
    cursor = d.cursor
  }
  return out
}

// ---------- Growth OS calls ----------

async function api(f: Fetch, path: string, init: { method?: string; body?: unknown } = {}) {
  const base = (process.env.GROWTH_OS_API ?? 'http://127.0.0.1:8767').replace(/\/$/, '')
  return f(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${env('GROWTH_OS_CREATOR_KEY')}`, 'content-type': 'application/json', 'x-growth-source': 'tiktok connector' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

export async function pull(f: Fetch = fetch as unknown as Fetch, now = Date.now()) {
  const stored = readToken()
  if (!stored) throw new Error('No TikTok authorization yet. Open the connector /start page first.')
  const token = await freshToken(f, stored, (t) => writeToken(t), now)
  const date = new Date(now).toISOString().slice(0, 10)
  const at = new Date(now).toISOString()

  const user = await getUser(f, token.accessToken)
  const snap = snapshotFrom(user, date)
  const s = await api(f, '/api/audience/snapshots', { method: 'POST', body: snap })
  const snapshot = s.ok ? snap.id : s.status === 409 ? `${snap.id} (already recorded today)` : `failed: HTTP ${s.status} ${(await s.text()).slice(0, 200)}`

  const videos = await listVideos(f, token.accessToken)
  const byId = new Map(videos.map((v) => [v.id, v]))
  const items = (await json(await api(f, '/api/content-items'))) as unknown as { id: string; platform: string; url: string; metrics?: Record<string, unknown> }[]
  const updated: string[] = []
  for (const c of Array.isArray(items) ? items : []) {
    const id = c.platform === 'tiktok' ? videoIdFromUrl(c.url ?? '') : null
    const v = id ? byId.get(id) : undefined
    if (!v) continue
    const r = await api(f, `/api/content/${encodeURIComponent(c.id)}`, { method: 'PATCH', body: { metrics: contentMetricsFrom(v, c.metrics ?? {}, at) } })
    if (r.ok) updated.push(c.id)
  }
  return { snapshot, metrics: Object.keys(snap.metrics), videos: videos.length, contentUpdated: updated }
}

// ---------- authorization page ----------

export function serve(f: Fetch = fetch as unknown as Fetch) {
  const port = Number(process.env.TIKTOK_CONNECTOR_PORT ?? 8768)
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
      return page(res, 302, 'Redirecting to TikTok.', authorizeUrl(env('TIKTOK_CLIENT_KEY'), env('TIKTOK_REDIRECT_URI'), state))
    }
    if (path.endsWith('/callback')) {
      const state = url.searchParams.get('state') ?? ''
      const expires = states.get(state)
      states.delete(state)
      if (!expires || expires < Date.now()) return page(res, 400, 'This sign-in link expired or did not start here. Open /start again.')
      if (url.searchParams.get('error')) return page(res, 400, `TikTok said: ${url.searchParams.get('error')}. Nothing was stored.`)
      const code = url.searchParams.get('code')
      if (!code) return page(res, 400, 'No authorization code. Nothing was stored.')
      exchangeCode(f, code).then(
        (t) => {
          writeToken(t)
          page(res, 200, `TikTok connected (scopes: ${t.scope}). The daily pull will use it. You can close this tab.`)
        },
        (e: Error) => page(res, 502, e.message),
      )
      return
    }
    page(res, 404, 'Open /start to connect TikTok.')
  })
  server.listen(port, '127.0.0.1', () => console.log(`TikTok connector on http://127.0.0.1:${port} (read-only)`))
  return server
}

if (require.main === module) {
  const mode = process.argv[2]
  if (mode === 'serve') serve()
  else if (mode === 'pull')
    pull().then(
      (r) => console.log(JSON.stringify(r)),
      (e: Error) => {
        console.error(e.message)
        process.exit(1)
      },
    )
  else {
    console.error('Usage: tiktok-connector serve|pull')
    process.exit(1)
  }
}
