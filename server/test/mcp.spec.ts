import type { INestApplication } from '@nestjs/common'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, basic, contentItem, makeApp, TOKENS } from './helpers'

type Result = { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: { result: any } }

describe('MCP server for the analyst', () => {
  let app: INestApplication
  let url: URL
  let client: Client
  const connect = async (token: string) => {
    const c = new Client({ name: 'test', version: '1.0.0' })
    await c.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
    return c
  }
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as Promise<Result>

  beforeAll(async () => {
    app = await makeApp()
    await app.listen(0, '127.0.0.1')
    url = new URL(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/mcp`)
    client = await connect(TOKENS.analyst)
  })
  afterAll(async () => {
    await client.close()
    await app.close()
  })

  it('lists the analyst tools, none of which can post, reply, like, follow or message', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['ack_handoff', 'create_engagement_items', 'create_experiment', 'create_handoff', 'create_lead', 'create_report', 'create_snapshot', 'get_experiments', 'get_openapi', 'get_snapshots', 'list_inbox'].sort(),
    )
    for (const t of tools) expect(t.name).not.toMatch(/post|publish|reply|like|follow|dm|message|send|tweet|brief|hook|script|caption/)
    const snapshot = tools.find((t) => t.name === 'create_snapshot')!
    expect(Object.keys(snapshot.inputSchema.properties ?? {})).not.toContain('verified')
    expect(JSON.stringify(snapshot.inputSchema)).not.toContain('$ref')
  })

  it('writes a draft snapshot with UNKNOWN for anything not observed, then an analysis handoff citing it', async () => {
    const id = await contentItem(app)
    const s = await call('create_snapshot', { platform: 'x', date: '2026-01-05', source: 'X audit', sourceType: 'analyst_agent', metrics: { followers: 10, posts: 'UNKNOWN' } })
    expect(s.isError).toBeFalsy()
    const snap = s.structuredContent!.result
    expect(snap).toMatchObject({ verified: false, metrics: { followers: 10, following: 'UNKNOWN', posts: 'UNKNOWN', views28d: 'UNKNOWN' }, _meta: { createdBy: 'analyst-agent' } })

    const bare = await call('create_handoff', { contentItemId: id, to: 'creative', type: 'analysis', body: 'No sources' })
    expect(bare.isError).toBe(true)
    expect(bare.content[0].text).toMatch(/^400: An analysis must cite/)

    const h = await call('create_handoff', { contentItemId: id, to: 'creative', type: 'analysis', body: 'Followers up.', refs: [{ collection: 'audience_snapshots', id: snap.id }] })
    expect(h.isError).toBeFalsy()
    expect(h.structuredContent!.result).toMatchObject({ from: 'analyst', type: 'analysis', refs: [{ collection: 'audience_snapshots', id: snap.id }] })
    expect((await as(app, basic).get(`/api/content-items/${id}/handoffs`)).body.map((x: { id: string }) => x.id)).toContain(h.structuredContent!.result.id)
  })

  it('cannot write outside the analyst collections or speak as someone else', async () => {
    const id = await contentItem(app)
    expect((await call('create_brief', { contentItemId: id })).isError).toBe(true)
    const spoof = await call('create_handoff', { contentItemId: id, from: 'creative', to: 'creator', type: 'question', body: 'x' })
    expect(spoof.isError).toBe(true)
    expect(spoof.content[0].text).toContain('from')
    expect((await call('create_snapshot', { platform: 'x', date: '2026-01-05', source: 's', metrics: {}, verified: true })).isError).toBe(true)
    expect((await call('create_lead', { summary: 'x', attributedRevenue: 100 })).isError).toBe(true)
    expect((await call('create_snapshot', { platform: 'all', date: '2026-01-05', source: 's', metrics: {} })).isError).toBe(true)
  })

  it('engagement items are always drafts, and sensitive ones are escalated without a reply', async () => {
    const r = await call('create_engagement_items', { items: [{ comment: 'How?', draftReply: 'Thanks' }, { comment: 'Hi' }, { comment: 'threat', category: 'sensitive', draftReply: 'x' }] })
    expect(r.structuredContent!.result.map((e: { status: string; draftReply: string }) => [e.status, e.draftReply])).toEqual([
      ['drafted', 'Thanks'],
      ['new', ''],
      ['escalated', ''],
    ])
    expect((await call('create_engagement_items', { items: [{ comment: 'x', status: 'approved' }] })).isError).toBe(true)
  })

  it('reads snapshots and experiments, and works the inbox', async () => {
    const id = await contentItem(app)
    expect((await call('create_experiment', { contentItemId: id, hypothesis: 'Demo hook', result: '2x shares' })).isError).toBeFalsy()
    expect((await call('get_experiments', { contentItemId: id })).structuredContent!.result).toHaveLength(1)
    expect((await call('get_snapshots', { since: '2026-01-01', platform: 'x' })).structuredContent!.result.length).toBeGreaterThan(0)
    expect((await call('get_openapi')).structuredContent!.result.openapi).toBe('3.1.0')
    const q = await as(app, basic).post('/api/handoffs', { contentItemId: id, to: 'analyst', type: 'question', body: 'Measure please' })
    const inbox = (await call('list_inbox')).structuredContent!.result as { id: string }[]
    expect(inbox.map((h) => h.id)).toContain(q.body.id)
    expect((await call('ack_handoff', { id: q.body.id })).structuredContent!.result.acknowledgedBy).toBe('analyst')
    expect(((await call('list_inbox')).structuredContent!.result as { id: string }[]).map((h) => h.id)).not.toContain(q.body.id)
  })

  it('only the analyst key can connect', async () => {
    for (const token of [TOKENS.creative, TOKENS.worker, 'wrong-token-wrong-token']) await expect(connect(token)).rejects.toThrow()
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' })
    expect(res.status).toBe(401)
    const creative = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${TOKENS.creative}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' })
    expect(creative.status).toBe(403)
  })
})
