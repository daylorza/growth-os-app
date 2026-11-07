import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as dto from '../src/dto'
import { buildOpenApi, canWrite, CREATIVE_PLATFORMS, ROUTES, WRITE_ACCESS } from '../src'

const errors = (cls: new () => object, body: object) => validateSync(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property)

/** The smallest valid body for every request DTO. */
const VALID: [new () => object, object][] = [
  [dto.CreateContentDto, {}],
  [dto.UpdateContentDto, { caption: 'x' }],
  [dto.DecisionDto, { decision: 'approve' }],
  [dto.CreateHandoffDto, { contentItemId: 'C-001', to: 'creative', type: 'analysis', body: 'x', refs: [{ collection: 'audience_snapshots', id: 'S-001' }] }],
  [dto.HandoffQuery, { acknowledged: 'false' }],
  [dto.CreateCreativeBriefDto, { contentItemId: 'C-001', sourceHandoffId: 'H-001' }],
  [dto.UpdateCreativeBriefDto, { objective: 'x' }],
  [dto.CreateHookDto, { contentItemId: 'C-001', kind: 'curiosity', text: 'x' }],
  [dto.UpdateHookDto, { text: 'y' }],
  [dto.CreateScriptDto, { contentItemId: 'C-001', body: 'x' }],
  [dto.UpdateScriptDto, { body: 'y' }],
  [dto.CreateCaptionDto, { contentItemId: 'C-001', platform: 'x', text: 'x' }],
  [dto.UpdateCaptionDto, { hashtags: '#a' }],
  [dto.CreateExperimentDto, { hypothesis: 'x' }],
  [dto.UpdateExperimentDto, { result: 'x' }],
  [dto.CreateEngagementDto, { comment: 'x' }],
  [dto.UpdateEngagementDto, { status: 'drafted' }],
  [dto.CreateLeadDto, { summary: 'x' }],
  [dto.UpdateLeadDto, { status: 'parked' }],
  [dto.CreateSnapshotDto, { platform: 'x', date: '2026-01-01', source: 'audit', metrics: {} }],
  [dto.LatestQuery, { platform: 'tiktok' }],
  [dto.SnapshotQuery, { since: '2026-01-01' }],
  [dto.SeriesQuery, { platform: 'x', metric: 'followers' }],
  [dto.SummaryQuery, { platform: 'x' }],
  [dto.TikTokVaultDto, { version: 1, handle: 'h', generatedAt: 'now', exports: [], daily: [], viewers: [], followers: [], videos: [], audience: {} }],
  [dto.ProfileDto, { creatorName: 'N', brandName: 'B', company: 'C', projectName: 'P', handles: {}, agents: { analyst: { name: 'A', role: 'r' }, creative: { name: 'Q', role: 'r' } }, sample: true }],
  [dto.PatchBriefDto, { fields: [{ key: 'goals', value: 'x' }] }],
  [dto.CreateKeywordDto, { keyword: 'X' }],
  [dto.UpdateKeywordDto, { active: true }],
  [dto.CreateResourceDto, { name: 'Guide', url: 'https://example.com/g' }],
  [dto.UpdateResourceDto, { description: 'Free guide' }],
  [dto.CreateTaskDto, { title: 'x' }],
  [dto.UpdateTaskDto, { done: true }],
  [dto.CreateCheckInDto, { kind: 'morning' }],
  [dto.UpdateCheckInDto, { fields: {} }],
  [dto.CreateReportDto, { evidence: 'x' }],
  [dto.UpdateReportDto, { limitations: 'x' }],
  [dto.SettingsDto, { campaignStart: '2026-01-01', tiktokGoal: 1, weeklyTikTokTarget: 1, planChecks: {} }],
  [dto.ImportDto, {}],
]

describe('contracts: every DTO', () => {
  it('covers every DTO used by a route', () => {
    const used = new Set(ROUTES.flatMap((r) => [r.body, r.query]).filter(Boolean))
    const tested = new Set(VALID.map(([c]) => c))
    expect([...used].filter((c) => !tested.has(c!)).map((c) => c!.name)).toEqual([])
  })

  it.each(VALID.map(([c, b]) => [c.name, c, b] as const))('%s accepts a minimal valid body and rejects unknown fields', (_, cls, body) => {
    expect(errors(cls, body)).toEqual([])
    expect(errors(cls, { ...body, autoPublish: true })).toContain('autoPublish')
  })

  it('handoffs require an item, recipient, type and body', () => {
    expect(errors(dto.CreateHandoffDto, {}).sort()).toEqual(['body', 'contentItemId', 'to', 'type'])
    expect(errors(dto.CreateHandoffDto, { contentItemId: 'C-001', to: 'everyone', type: 'analysis', body: 'x' })).toEqual(['to'])
    expect(errors(dto.CreateHandoffDto, { contentItemId: 'C-001', to: 'creative', type: 'post', body: 'x' })).toEqual(['type'])
  })

  it('snapshots require a platform, date, source and metrics', () => {
    expect(errors(dto.CreateSnapshotDto, {}).sort()).toEqual(['date', 'metrics', 'platform', 'source'])
    expect(errors(dto.CreateSnapshotDto, { platform: 'all', date: '2026-01-01', source: 's', metrics: {} })).toEqual(['platform'])
  })

  it('briefs cite their source handoff', () => {
    expect(errors(dto.CreateCreativeBriefDto, { contentItemId: 'C-001' })).toEqual(['sourceHandoffId'])
  })
})

describe('contracts: UNKNOWN', () => {
  const m = (metrics: object) => errors(dto.CreateSnapshotDto, { platform: 'x', date: '2026-01-01', source: 's', metrics })

  it('accepts a number, "UNKNOWN", null or nothing for every metric', () => {
    for (const k of dto.METRICS) {
      expect(m({ [k]: 12 })).toEqual([])
      expect(m({ [k]: 0 })).toEqual([])
      expect(m({ [k]: 'UNKNOWN' })).toEqual([])
      expect(m({ [k]: null })).toEqual([])
    }
  })

  it('rejects estimates, negatives, lowercase unknown and other strings', () => {
    for (const bad of ['about 10', '10', 'unknown', 'N/A', -1, Number.NaN, Number.POSITIVE_INFINITY, true]) expect(m({ followers: bad }), String(bad)).toEqual(['metrics'])
  })

  it('types metrics as number | "UNKNOWN" in the OpenAPI spec', () => {
    const schema = (buildOpenApi() as any).components.schemas.MetricsDto.properties.followers
    expect(schema).toEqual({ oneOf: [{ type: 'number', minimum: 0 }, { type: 'string', enum: ['UNKNOWN'] }] })
  })
})

describe('contracts: ownership and spec', () => {
  it('agents write only their own collections', () => {
    for (const c of ['briefs', 'hooks', 'scripts', 'captions'] as const) expect([canWrite('creative', c), canWrite('analyst', c)]).toEqual([true, false])
    for (const c of ['experiments', 'reports', 'leads'] as const) expect([canWrite('analyst', c), canWrite('creative', c)]).toEqual([true, false])
    // Snapshots and the engagement queue: both agents, the creative agent for CREATIVE_PLATFORMS only (enforced by the services).
    for (const c of ['audience_snapshots', 'engagement_queue'] as const) expect([canWrite('analyst', c), canWrite('creative', c)]).toEqual([true, true])
    expect(CREATIVE_PLATFORMS).toEqual(['tiktok', 'threads'])
    for (const c of Object.keys(WRITE_ACCESS) as (keyof typeof WRITE_ACCESS)[]) {
      expect(canWrite('creator', c)).toBe(true)
      expect(canWrite('worker', c)).toBe(false)
    }
  })

  it('the committed openapi.json matches the DTOs (run `pnpm openapi` after changing them)', () => {
    const committed = readFileSync(join(__dirname, '..', 'openapi.json'), 'utf8')
    expect(committed).toBe(`${JSON.stringify(buildOpenApi(), null, 2)}\n`)
  })

  it('no route in the spec posts, publishes, replies or messages on a platform', () => {
    for (const r of ROUTES) expect(`${r.method} ${r.path}`).not.toMatch(/publish|tweet|reply|\bdm\b|message|like|follow|upload/i)
  })
})
