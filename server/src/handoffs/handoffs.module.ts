import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common'
import { AUDIT_ID, CreateHandoffDto, HandoffQuery, type ContentItem, type EventName, type Handoff, type Ref } from '@growth-os/contracts'
import { isCreator, Writer, type WriteContext } from '../common/actor'
import { CollectionService, RuleViolation, stamp } from '../common/collection.service'
import { EVENT_FOR_TYPE, EventsModule, EventsService } from '../events/events.module'
import { AuditService } from '../db/audit.service'
import { DuplicateIdError, Store } from '../db/store'

const DAY_MS = 86_400_000
const today = () => new Date().toISOString().slice(0, 10)

/**
 * The handoff log is the conversation between the agents and the creator. Agents send only as themselves;
 * every handoff names a content item (or a daily audit id); analyses and briefs must cite their sources.
 * Writing a handoff wakes its recipient through the events outbox.
 */
@Injectable()
export class HandoffsService extends CollectionService<Handoff> {
  protected readonly collectionName = 'handoffs'
  protected readonly idPrefix = 'H'

  constructor(
    store: Store,
    audit: AuditService,
    private readonly events: EventsService,
  ) {
    super(store, audit)
  }

  protected defaults(_: Partial<Handoff>, ctx: WriteContext): Omit<Handoff, 'id'> {
    return { contentItemId: '', from: ctx.actor.role === 'worker' ? 'creator' : ctx.actor.role, to: 'creator', type: 'question', body: '', refs: [], createdAt: new Date().toISOString() }
  }

  private async exists(collection: string, id: string) {
    const known = ['content_items', 'handoffs', 'audience_snapshots', 'experiments', 'briefs', 'hooks', 'scripts', 'captions', 'engagement_queue', 'reports', 'leads'] as const
    const c = known.find((k) => k === collection)
    return !!c && !!(await this.store.collection(c).get(id))
  }

  private async validate(ctx: WriteContext, h: Handoff) {
    if (!h.contentItemId?.trim()) throw new BadRequestException('Every handoff names a content item ID.')
    if (!AUDIT_ID.test(h.contentItemId) && !(await this.exists('content_items', h.contentItemId))) throw new BadRequestException(`Content item ${h.contentItemId} does not exist.`)
    if (!isCreator(ctx.actor) && h.from !== ctx.actor.role) throw new ForbiddenException(`A ${ctx.actor.role} key can only send handoffs from ${ctx.actor.role}.`)
    if (h.from === h.to) throw new BadRequestException('A handoff goes to someone else.')
    for (const r of h.refs) if (!(await this.exists(r.collection, r.id))) throw new BadRequestException(`Cited ${r.collection}/${r.id} does not exist.`)
    // Shared memory: no analysis without cited data, no brief without the analysis it builds on.
    if (!isCreator(ctx.actor) && h.type === 'analysis' && !h.refs.some((r) => r.collection === 'audience_snapshots' || r.collection === 'experiments'))
      throw new BadRequestException('An analysis must cite the snapshots or experiments it used (refs).')
    if (!isCreator(ctx.actor) && h.type === 'brief') {
      const cited = await Promise.all(h.refs.filter((r) => r.collection === 'handoffs').map((r) => this.repo.get(r.id)))
      if (!cited.some((c) => c && (c.type === 'analysis' || c.type === 'result'))) throw new BadRequestException('A brief must cite the analysis handoff it used (refs).')
    }
  }

  /** A handoff from the API: validated, stored, and its recipient woken. */
  async send(ctx: WriteContext, input: Partial<Handoff>, event: EventName | undefined = EVENT_FOR_TYPE[input.type ?? 'question']) {
    this.own(ctx)
    const draft = { ...this.defaults(input, ctx), ...input, refs: input.refs ?? [] } as Handoff
    await this.validate(ctx, draft)
    const h = await this.create(ctx, draft)
    if (event) await this.events.emit(event, h)
    return h
  }

  /**
   * Handoffs the API writes itself (publish, decisions, scheduled requests). Deterministic ids make them
   * idempotent: a repeat returns the existing handoff and sends nothing new.
   */
  async system(ctx: WriteContext, id: string, input: Omit<Handoff, 'id' | 'createdAt'>, event?: EventName) {
    const existing = await this.repo.get(id)
    if (existing) return { handoff: existing, created: false }
    const h: Handoff = { ...input, id, createdAt: new Date().toISOString(), _meta: stamp(ctx) }
    try {
      await this.repo.insert(h)
    } catch (e) {
      if (e instanceof DuplicateIdError) return { handoff: (await this.repo.get(id))!, created: false }
      throw e
    }
    await this.audit.record(ctx, 'create', 'handoffs', id)
    if (event) await this.events.emit(event, h)
    return { handoff: h, created: true }
  }

  /** Marks a handoff read. Only its recipient can acknowledge it. */
  async ack(ctx: WriteContext, id: string) {
    const h = await this.get(id)
    if (ctx.actor.role !== h.to) throw new ForbiddenException('Only the recipient can acknowledge a handoff.')
    if (h.acknowledgedAt) return h
    const next = { ...h, acknowledgedAt: new Date().toISOString(), acknowledgedBy: h.to, _meta: stamp(ctx, h._meta) }
    await this.repo.replace(next)
    await this.audit.record(ctx, 'update', 'handoffs', id)
    return next
  }

  /** Handoffs are a log: never edited through the API. */
  protected checkWrite(_ctx: WriteContext, prev: Handoff | null) {
    if (prev) throw new RuleViolation('Handoffs are a log. Send a new handoff instead of editing one.', 'forbidden')
  }

  async query(q: HandoffQuery) {
    const items = await this.list({
      ...(q.to ? { to: q.to } : {}),
      ...(q.contentItemId ? { contentItemId: q.contentItemId } : {}),
    })
    return items.filter((h) => (q.acknowledged === undefined ? true : (q.acknowledged === 'true') === !!h.acknowledgedAt)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** The thread for one item, oldest first. */
  async thread(contentItemId: string) {
    return (await this.list({ contentItemId })).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }

  overdue(handoffs: Handoff[], now = Date.now()) {
    return handoffs.filter((h) => !h.acknowledgedAt && now - Date.parse(h.createdAt) > DAY_MS)
  }

  // ---------- scheduler ----------

  private async xHandle() {
    const p = await this.store.collection<{ id: string; value: { handles?: Record<string, string> } }>('profiles').get('main')
    return p?.value.handles?.x ?? 'the X account in the profile'
  }

  /** Today's audit request for the analyst. Idempotent per day. */
  async dailyAudit(ctx: WriteContext) {
    const date = today()
    const since = new Date(Date.now() - 28 * DAY_MS).toISOString().slice(0, 10)
    const body = `Daily audit for ${date}. Audit ${await this.xHandle()} on X, read-only.\n\nBefore writing: read the snapshots since ${since} (GET /api/audience/snapshots?since=${since}) and the experiment log (GET /api/experiments). Then write a snapshot, the engagement queue and an analysis handoff that cites the item IDs you used. Everything stays a draft.`
    return this.system(ctx, `H-AUDIT-${date}`, { contentItemId: `AUDIT-${date}`, from: 'creator', to: 'analyst', type: 'question', body, refs: [] }, 'daily_audit')
  }

  /** measure_request 24h and 72h after a post was published. Idempotent per item and window. */
  async measureRequests(ctx: WriteContext, now = Date.now()) {
    const items = await this.store.collection<ContentItem>('content_items').list({ status: 'published' })
    const sent: string[] = []
    for (const c of items) {
      const at = Date.parse(c.publishedAt)
      if (!Number.isFinite(at)) continue
      for (const hours of [24, 72]) {
        if (now < at + hours * 3_600_000) continue
        const refs: Ref[] = [{ collection: 'content_items', id: c.id }]
        const body = `Measure ${c.id} at ${hours}h after publishing (${c.url}). Record the results in the experiment log${c.experimentId ? ` (${c.experimentId})` : ''}; compare with similar posts at the same age.`
        const r = await this.system(ctx, `H-MEASURE-${c.id}-${hours}h`, { contentItemId: c.id, from: 'creator', to: 'analyst', type: 'question', body, refs }, 'measure_request')
        if (r.created) sent.push(r.handoff.id)
      }
    }
    return { sent }
  }
}

@Controller('api/handoffs')
export class HandoffsController {
  constructor(private readonly handoffs: HandoffsService) {}

  @Get()
  list(@Query() q: HandoffQuery) {
    return this.handoffs.query(q)
  }

  @Post()
  create(@Writer() w: WriteContext, @Body() body: CreateHandoffDto) {
    return this.handoffs.send(w, body as Partial<Handoff>)
  }

  @Post(':id/ack')
  ack(@Writer() w: WriteContext, @Param('id') id: string) {
    return this.handoffs.ack(w, id)
  }
}

/** Scheduler entry points. The worker has no other access. */
@Controller('api/dispatch')
export class DispatchController {
  constructor(private readonly handoffs: HandoffsService) {}

  @Post('daily-audit')
  daily(@Writer() w: WriteContext) {
    return this.handoffs.dailyAudit(w)
  }

  @Post('measure-requests')
  measure(@Writer() w: WriteContext) {
    return this.handoffs.measureRequests(w)
  }
}

@Module({ imports: [EventsModule], controllers: [HandoffsController, DispatchController], providers: [HandoffsService], exports: [HandoffsService] })
export class HandoffsModule {}
