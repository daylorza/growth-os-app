/**
 * FALLBACK ONLY, disabled by default. The primary path is the dispatch worker: the analyst agent is woken by a
 * webhook and reads X through its own connection. This fallback is for when that listener is unavailable:
 * it asks xAI's model to audit the creator's public X account with xAI's built-in X search (read-only),
 * then writes the analysis, an unverified X snapshot and draft replies into the endpoint as the analyst.
 * It never posts, replies, likes, follows or messages.
 *
 * Modes:
 *   (no XAI_API_KEY)        does nothing. Paste-in mode: the creator pastes the analyst's reply in the dashboard.
 *   --paste <file>          stores a saved analyst reply from a file, same as the dashboard paste.
 *   live (XAI_API_KEY set)  STEP 2, needs the creator's key on the host: calls the xAI Responses API with x_search.
 *
 * Env: GROWTH_OS_API, GROWTH_OS_ANALYST_KEY, XAI_API_KEY, XAI_MODEL, ANALYST_DRY_RUN=1.
 */
import { readFileSync } from 'node:fs'
import { parseAnalystReply, type AnalystAudit } from './analyst-reply'

const XAI_URL = 'https://api.x.ai/v1/responses'
const today = () => new Date().toISOString().slice(0, 10)

interface Env {
  api: string
  token: string
  xaiKey?: string
  model?: string
  dryRun: boolean
}

const env = (): Env => {
  const token = process.env.GROWTH_OS_ANALYST_KEY ?? ''
  if (!token) throw new Error('GROWTH_OS_ANALYST_KEY is required.')
  return {
    api: (process.env.GROWTH_OS_API ?? 'http://127.0.0.1:8767').replace(/\/$/, ''),
    token,
    xaiKey: process.env.XAI_API_KEY || undefined,
    model: process.env.XAI_MODEL || undefined,
    dryRun: process.env.ANALYST_DRY_RUN === '1',
  }
}

async function api<T>(e: Env, method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
  const res = await fetch(`${e.api}${path}`, {
    method,
    headers: { authorization: `Bearer ${e.token}`, 'content-type': 'application/json', 'x-growth-source': 'xai fallback' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

interface Profile {
  creatorName: string
  handles: Record<string, string>
  agents: { analyst: { name: string; role: string }; creative: { name: string } }
  masterPrompt?: string
}

export function systemPrompt(p: Profile): string {
  const me = p.agents.analyst
  const header = `You are ${me.name}, ${me.role}, on ${p.creatorName}'s growth team. Draft-only: do not post, publish, reply, like, follow or message. You only observe public data and draft.`
  return p.masterPrompt ? `${header}\n\n${p.masterPrompt}` : header
}

export function auditPrompt(p: Profile, handle: string, latest: unknown, openHandoffs: unknown): string {
  return `Audit the public X account @${handle} for ${today()} using X search only (read-only).

Snapshots from the last four weeks (cite the ids you rely on): ${JSON.stringify(latest)}
Open handoffs: ${JSON.stringify(openHandoffs)}

Write a short report for ${p.agents.creative.name} and ${p.creatorName}: what changed, which posts worked and why, repeated questions, three content opportunities, and limitations of what you could see.
Rules: record only numbers you actually observed, with their date. If you could not observe a number, omit it. Never estimate. Do not draft anything that promises prices, DMs or response times.

End with exactly one fenced \`\`\`json block:
{"report": "<the report>", "xSnapshot": {"date": "YYYY-MM-DD", "followers": <int, only if observed>, "following": <int>, "posts": <int>} or null,
 "engagementQueue": [{"sourcePost": "<post URL>", "author": "@handle", "comment": "<their words>", "category": "question|technical|appreciation|criticism|client_inquiry|collaboration|spam|sensitive", "draftReply": "<draft in ${p.creatorName}'s voice, empty for sensitive>"}]}`
}

/** Pulls the assistant text out of a Responses API result. */
export function responseText(r: { output_text?: string; output?: { type?: string; content?: { type?: string; text?: string }[] }[] }): string {
  if (r.output_text) return r.output_text
  return (r.output ?? [])
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text' && c.text)
    .map((c) => c.text)
    .join('\n')
}

async function callXai(e: Env, system: string, user: string, handle: string): Promise<string> {
  if (!e.model) throw new Error('XAI_MODEL is required for live mode (set it in the worker environment).')
  const res = await fetch(XAI_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${e.xaiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: e.model,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      tools: [{ type: 'x_search', allowed_x_handles: [handle] }],
    }),
  })
  if (!res.ok) throw new Error(`xAI ${res.status}: ${(await res.text()).slice(0, 500)}`)
  return responseText((await res.json()) as Parameters<typeof responseText>[0])
}

/** Writes an audit into the endpoint: engagement drafts, an unverified X snapshot, then one analysis handoff citing its data. */
export async function store(e: Env, p: Profile, audit: AnalystAudit, via: string, cited: string[] = []) {
  const itemId = `AUDIT-${today()}`
  const created: string[] = []
  for (const q of audit.engagementQueue) {
    const r = await api<{ id: string }>(e, 'POST', '/api/engagement-queue', {
      platform: 'x',
      sourcePost: q.sourcePost ?? '',
      author: q.author ?? '',
      comment: q.comment,
      keyword: q.keyword ?? '',
      ...(q.category ? { category: q.category } : {}),
      draftReply: q.category === 'sensitive' ? '' : (q.draftReply ?? ''),
      status: q.category === 'sensitive' ? 'escalated' : q.draftReply ? 'drafted' : 'new',
      note: `From ${itemId}`,
    })
    created.push(r.id)
  }
  let snapshotId: string | null = null
  if (audit.xSnapshot) {
    const { date, ...metrics } = audit.xSnapshot
    const r = await api<{ id: string }>(e, 'POST', '/api/audience/snapshots', { platform: 'x', date, source: `X via ${p.agents.analyst.name} (${via})`, sourceType: 'analyst_agent', metrics, verified: false })
    snapshotId = r.id
  }
  const refs = [...cited, ...(snapshotId ? [snapshotId] : [])].map((id) => ({ collection: 'audience_snapshots', id }))
  const footer = [created.length ? `Engagement drafts: ${created.join(', ')}` : 'No engagement drafts.', snapshotId ? `Unverified X snapshot: ${snapshotId}` : 'No X numbers observed.'].join('\n')
  const handoff = await api<{ id: string }>(e, 'POST', '/api/handoffs', { contentItemId: itemId, from: 'analyst', to: 'creative', type: refs.length ? 'analysis' : 'question', body: `${audit.report}\n\n${footer}`, refs })
  return { handoff: handoff.id, engagement: created, snapshot: snapshotId }
}

async function main() {
  const e = env()
  const args = process.argv.slice(2)
  const pasteAt = args.indexOf('--paste')
  const profile = await api<Profile>(e, 'GET', '/api/profile')

  if (pasteAt >= 0) {
    const file = args[pasteAt + 1]
    if (!file) throw new Error('--paste needs a file path.')
    console.log(JSON.stringify(await store(e, profile, parseAnalystReply(readFileSync(file, 'utf8')), 'pasted')))
    return
  }
  if (!e.xaiKey) {
    console.log('Paste-in mode: XAI_API_KEY is not set, so no live audit runs. Paste the analyst reply in the dashboard instead.')
    return
  }
  const handle = profile.handles.x?.replace(/^@/, '')
  if (!handle) throw new Error('The profile has no X handle.')
  const since = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10)
  const recent = await api<{ id: string; platform: string; date: string; metrics: unknown }[]>(e, 'GET', `/api/audience/snapshots?platform=x&since=${since}`)
  const open = await api<{ id: string; contentItemId: string; to: string }[]>(e, 'GET', '/api/handoffs?acknowledged=false')
  const text = await callXai(e, systemPrompt(profile), auditPrompt(profile, handle, recent, open.map(({ id, contentItemId, to }) => ({ id, contentItemId, to }))), handle)
  const audit = parseAnalystReply(text)
  if (e.dryRun) {
    console.log(JSON.stringify(audit, null, 2))
    return
  }
  console.log(JSON.stringify(await store(e, profile, audit, 'xai fallback', recent.map((r) => r.id))))
}

if (require.main === module)
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
