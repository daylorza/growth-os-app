import { Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common'
import { CreateSnapshotDto, LatestQuery, METRICS, SnapshotQuery, TikTokVaultDto, toMetric, type AudienceMetrics, type AudienceSnapshot, type Platform, type Singleton } from '@growth-os/contracts'
import { isCreator, Writer, type WriteContext } from '../common/actor'
import { CollectionService, stamp } from '../common/collection.service'
import { checkVerified } from '../common/draft-only'
import { AnalyticsModule, AnalyticsService } from '../analytics/analytics.module'
import { AuditService } from '../db/audit.service'
import { Store } from '../db/store'

export { CreateSnapshotDto, TikTokVaultDto }

export const normalizeMetrics = (m: Partial<Record<string, unknown>> = {}): AudienceMetrics =>
  Object.fromEntries(METRICS.map((k) => [k, toMetric(m[k])])) as unknown as AudienceMetrics

@Injectable()
export class AudienceService extends CollectionService<AudienceSnapshot> {
  protected readonly collectionName = 'audience_snapshots'
  protected readonly idPrefix = 'S'

  constructor(
    store: Store,
    audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {
    super(store, audit)
  }

  /** Snapshots are also appended to the analytics fact table. */
  async create(ctx: WriteContext, input: Partial<AudienceSnapshot>) {
    const doc = await super.create(ctx, input)
    await this.analytics.appendSnapshot(ctx, doc)
    return doc
  }

  async remove(ctx: WriteContext, id: string) {
    const prev = await this.get(id)
    const result = await super.remove(ctx, id)
    await this.analytics.appendRetraction(ctx, prev)
    return result
  }

  async importOne(ctx: WriteContext, doc: AudienceSnapshot) {
    const r = await super.importOne(ctx, doc)
    if (r === 'inserted') await this.analytics.appendSnapshot(ctx, await this.get(doc.id))
    return r
  }

  protected defaults(input: Partial<AudienceSnapshot>): Omit<AudienceSnapshot, 'id'> {
    return { platform: input.platform ?? 'tiktok', date: '', source: '', sourceType: 'manual', metrics: normalizeMetrics(), verified: false }
  }

  protected checkWrite(ctx: WriteContext, prev: AudienceSnapshot | null, next: AudienceSnapshot) {
    checkVerified(ctx.actor, prev?.verified, next.verified)
  }

  createSnapshot(ctx: WriteContext, body: CreateSnapshotDto) {
    return this.create(ctx, { ...body, metrics: normalizeMetrics(body.metrics as Record<string, unknown>) })
  }

  /** Snapshots for one platform (or all, each still per platform), optionally since a date: e.g. the last four weeks. */
  async query(q: SnapshotQuery) {
    const items = await this.list(q.platform ? { platform: q.platform } : undefined)
    return items.filter((s) => !q.since || s.date >= q.since).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  }

  /** Latest snapshot for exactly one platform. There is no cross-platform total. */
  async latest(platform: Platform) {
    const items = (await this.list({ platform })).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    if (!items.length) throw new NotFoundException(`No ${platform} snapshot yet.`)
    return items[0]
  }

  private get vault() {
    return this.store.collection<Singleton<TikTokVaultDto>>('tiktok_vault')
  }

  async getVault() {
    return (await this.vault.get('latest'))?.value ?? null
  }

  /** Normalised TikTok Studio export data produced by the ingest script. Creator only. */
  async putVault(ctx: WriteContext, value: TikTokVaultDto) {
    if (!isCreator(ctx.actor)) throw new ForbiddenException('Only the creator uploads export data.')
    const prev = await this.vault.get('latest')
    const doc = { id: 'latest', value, _meta: stamp(ctx, prev?._meta) }
    if (!(await this.vault.replace(doc))) await this.vault.insert(doc)
    await this.audit.record(ctx, prev ? 'update' : 'create', 'tiktok_vault', 'latest')
    return { exports: value.exports.length, generatedAt: value.generatedAt }
  }
}

@Controller('api/audience')
export class AudienceController {
  constructor(private readonly audience: AudienceService) {}

  @Get('latest')
  latest(@Query() q: LatestQuery) {
    return this.audience.latest(q.platform)
  }

  @Get('snapshots')
  list(@Query() q: SnapshotQuery) {
    return this.audience.query(q)
  }

  @Post('snapshots')
  create(@Writer() w: WriteContext, @Body() body: CreateSnapshotDto) {
    return this.audience.createSnapshot(w, body)
  }

  @Delete('snapshots/:id')
  remove(@Writer() w: WriteContext, @Param('id') id: string) {
    return this.audience.remove(w, id)
  }

  @Get('tiktok-vault')
  vault() {
    return this.audience.getVault()
  }

  @Put('tiktok-vault')
  putVault(@Writer() w: WriteContext, @Body() body: TikTokVaultDto) {
    return this.audience.putVault(w, body)
  }
}

@Module({ imports: [AnalyticsModule], controllers: [AudienceController], providers: [AudienceService], exports: [AudienceService] })
export class AudienceModule {}
