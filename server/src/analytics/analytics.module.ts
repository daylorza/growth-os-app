import { BadRequestException, Controller, Get, Injectable, Module, Query } from '@nestjs/common'
import type { WriteContext } from '../common/actor'
import { METRICS, SeriesQuery, SummaryQuery, type AudienceSnapshot, type BaseDoc, type MetricName, type Platform } from '@growth-os/contracts'
import { UNKNOWN } from '@growth-os/contracts'
import { Store } from '../db/store'

/**
 * Lakehouse-style analytics over audience snapshots, shaped to map 1:1 onto Databricks:
 * - `analytics_facts` is an append-only, long-format fact table (Delta-style): rows are inserted, never updated.
 *   Removing a snapshot appends a `retract` row instead of deleting history.
 * - Table and column definitions live in ANALYTICS_CATALOG (Unity Catalog-style: catalog.schema.table, typed columns, tags).
 * - Every query returns the equivalent Spark SQL, and is always scoped to one platform. There is no cross-platform total.
 */

export interface Fact extends BaseDoc {
  op: 'observe' | 'retract'
  snapshotId: string
  platform: Platform
  date: string
  metric: MetricName | '*'
  /** Observed value. UNKNOWN metrics are not written as facts at all. */
  value: number | null
  source: string
  sourceType: string
  verified: boolean
  ingestedAt: string
  ingestedBy: string
}

export const ANALYTICS_CATALOG = {
  catalog: 'growth_os',
  tables: [
    {
      name: 'growth_os.audience.snapshot_facts',
      collection: 'analytics_facts',
      format: 'delta (append-only)',
      partitionBy: ['platform'],
      tags: { contains_pii: 'false', platform_scoped: 'true', write_mode: 'append_only' },
      columns: [
        { name: 'id', type: 'STRING', nullable: false },
        { name: 'op', type: "STRING CHECK (op IN ('observe','retract'))", nullable: false },
        { name: 'snapshot_id', type: 'STRING', nullable: false },
        { name: 'platform', type: "STRING CHECK (platform IN ('tiktok','x'))", nullable: false },
        { name: 'date', type: 'DATE', nullable: false },
        { name: 'metric', type: 'STRING', nullable: false },
        { name: 'value', type: 'DOUBLE', nullable: true },
        { name: 'source', type: 'STRING', nullable: false },
        { name: 'source_type', type: 'STRING', nullable: false },
        { name: 'verified', type: 'BOOLEAN', nullable: false },
        { name: 'ingested_at', type: 'TIMESTAMP', nullable: false },
        { name: 'ingested_by', type: 'STRING', nullable: false },
      ],
    },
  ],
} as const

const TABLE = ANALYTICS_CATALOG.tables[0].name
const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`

@Injectable()
export class AnalyticsService {
  constructor(private readonly store: Store) {}

  private get facts() {
    return this.store.collection<Fact>('analytics_facts')
  }

  /** Called on every snapshot write. Only observed numbers become facts; UNKNOWN stays absent, never 0. */
  async appendSnapshot(ctx: WriteContext, s: AudienceSnapshot) {
    const ingestedAt = new Date().toISOString()
    for (const metric of METRICS) {
      const value = s.metrics[metric]
      if (value === UNKNOWN) continue
      await this.facts.insert({ id: `${s.id}:${metric}:${ingestedAt}`, op: 'observe', snapshotId: s.id, platform: s.platform, date: s.date, metric, value, source: s.source, sourceType: s.sourceType, verified: s.verified, ingestedAt, ingestedBy: ctx.actor.name })
    }
  }

  async appendRetraction(ctx: WriteContext, s: AudienceSnapshot) {
    const ingestedAt = new Date().toISOString()
    await this.facts.insert({ id: `${s.id}:retract:${ingestedAt}`, op: 'retract', snapshotId: s.id, platform: s.platform, date: s.date, metric: '*', value: null, source: s.source, sourceType: s.sourceType, verified: s.verified, ingestedAt, ingestedBy: ctx.actor.name })
  }

  /** Live facts for one platform: observations whose snapshot was not retracted. */
  private async live(platform: Platform) {
    const rows = await this.facts.list({ platform })
    // Later operations win (Delta-style): an observation is live unless a retraction for its snapshot came after it.
    const retractedAt = new Map<string, string>()
    for (const r of rows) if (r.op === 'retract' && r.ingestedAt > (retractedAt.get(r.snapshotId) ?? '')) retractedAt.set(r.snapshotId, r.ingestedAt)
    return rows.filter((r) => r.op === 'observe' && !(r.ingestedAt <= (retractedAt.get(r.snapshotId) ?? '')))
  }

  /** Latest observed value per date for one metric on one platform. */
  async series(q: SeriesQuery) {
    const byDate = new Map<string, Fact>()
    for (const r of await this.live(q.platform)) {
      if (r.metric !== q.metric) continue
      const cur = byDate.get(r.date)
      if (!cur || r.ingestedAt > cur.ingestedAt) byDate.set(r.date, r)
    }
    const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ date: r.date, value: r.value, source: r.source, verified: r.verified }))
    return {
      platform: q.platform,
      metric: q.metric,
      points,
      sql: `SELECT date, max_by(value, ingested_at) AS value
FROM ${TABLE} f
WHERE platform = ${sqlString(q.platform)} AND metric = ${sqlString(q.metric)} AND op = 'observe'
  AND NOT EXISTS (SELECT 1 FROM ${TABLE} r WHERE r.op = 'retract' AND r.snapshot_id = f.snapshot_id AND r.ingested_at >= f.ingested_at)
GROUP BY date ORDER BY date`,
    }
  }

  /** Start/end/net per metric over a window for one platform. Growth % only when start > 0. */
  async summary(q: SummaryQuery) {
    if (q.from && q.to && q.from > q.to) throw new BadRequestException('from must be on or before to.')
    const out: Record<string, { start: number | typeof UNKNOWN; end: number | typeof UNKNOWN; net: number | typeof UNKNOWN; growthPct: number | typeof UNKNOWN; from: string | null; to: string | null }> = {}
    for (const metric of METRICS) {
      const pts = (await this.series({ platform: q.platform, metric })).points.filter((p) => (!q.from || p.date >= q.from) && (!q.to || p.date <= q.to))
      const first = pts[0]
      const last = pts.at(-1)
      const start = first?.value ?? UNKNOWN
      const end = last?.value ?? UNKNOWN
      const net = typeof start === 'number' && typeof end === 'number' && pts.length > 1 ? end - start : UNKNOWN
      const growthPct = typeof net === 'number' && typeof start === 'number' && start > 0 ? Math.round((net / start) * 1000) / 10 : UNKNOWN
      out[metric] = { start, end, net, growthPct, from: first?.date ?? null, to: last?.date ?? null }
    }
    const window = [q.from && `date >= ${sqlString(q.from)}`, q.to && `date <= ${sqlString(q.to)}`].filter(Boolean).join(' AND ')
    return {
      platform: q.platform,
      metrics: out,
      sql: `WITH live AS (
  SELECT * FROM ${TABLE} f
  WHERE platform = ${sqlString(q.platform)} AND op = 'observe'${window ? ` AND ${window}` : ''}
    AND NOT EXISTS (SELECT 1 FROM ${TABLE} r WHERE r.op = 'retract' AND r.snapshot_id = f.snapshot_id AND r.ingested_at >= f.ingested_at)
), daily AS (
  SELECT metric, date, max_by(value, ingested_at) AS value FROM live GROUP BY metric, date
)
SELECT metric, min_by(value, date) AS start, max_by(value, date) AS end,
       max_by(value, date) - min_by(value, date) AS net
FROM daily GROUP BY metric`,
    }
  }
}

@Controller('api/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('catalog')
  catalog() {
    return ANALYTICS_CATALOG
  }

  @Get('series')
  series(@Query() q: SeriesQuery) {
    return this.analytics.series(q)
  }

  @Get('summary')
  summary(@Query() q: SummaryQuery) {
    return this.analytics.summary(q)
  }
}

@Module({ controllers: [AnalyticsController], providers: [AnalyticsService], exports: [AnalyticsService] })
export class AnalyticsModule {}
