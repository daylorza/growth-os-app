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

  /** An X refresh request for the analyst, on today's audit thread. Idempotent per 4-hour UTC window. */
  async xRefresh(ctx: WriteContext, now = Date.now()) {
    const at = new Date(now).toISOString()
    const date = at.slice(0, 10)
    const window = String(Math.floor(new Date(now).getUTCHours() / 4) * 4).padStart(2, '0')
    const body = `X refresh for ${date}, ${window}:00 UTC window. Read ${await this.xHandle()} on X, read-only.\n\nWrite one snapshot (platform x, date ${date}, sourceType analyst_agent) with the followers, following and post counts you can see. Anything you cannot see stays "UNKNOWN", never 0. No analysis handoff unless something changed notably; if it did, cite the snapshots you compared. Everything stays a draft.`
    return this.system(ctx, `H-XREFRESH-${date}-${window}`, { contentItemId: `AUDIT-${date}`, from: 'creator', to: 'analyst', type: 'question', body, refs: [] }, 'x_refresh')
  }

  /** The weekly TikTok and Threads refresh for the creative agent, after Sunday's stats. Idempotent per ISO week. */
  async weeklyRefresh(ctx: WriteContext, now = Date.now()) {
    const date = new Date(now).toISOString().slice(0, 10)
    const weekStart = new Date(now - ((new Date(now).getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10)
    const p = await this.store.collection<{ id: string; value: { handles?: Record<string, string> } }>('profiles').get('main')
    const handle = (k: string) => p?.value.handles?.[k] || `the ${k} account in the profile`
    const body = `Weekly refresh, sent ${date} (week starting ${weekStart}). Read TikTok (${handle('tiktok')}) in TikTok Studio → Analytics and Threads (${handle('threads')}) in Threads Insights, read-only.\n\nUse a browser session that is already signed in. Never type a password or a two-factor code; if a sign-in is needed, stop and ask the creator. Only open and read pages: do not post, reply, like, follow, message or change any setting.\n\nFor each platform write one snapshot (POST /api/audience/snapshots: platform tiktok or threads, date ${date}, sourceType creative_agent, source = the page you read, e.g. "TikTok Studio Analytics, last 7 days") with metrics followers, following, posts, views7d, views28d and engagementRate (percent) as shown. Anything you cannot see stays "UNKNOWN", never 0. Platforms are never added together. Then ack this handoff and send the analyst a question handoff on AUDIT-${date} citing both snapshot ids. Everything stays a draft.`
    return this.system(ctx, `H-WEEKLY-${weekStart}`, { contentItemId: `AUDIT-${date}`, from: 'creator', to: 'creative', type: 'question', body, refs: [] }, 'weekly_refresh')
  }

  /** New TikTok, Threads and Instagram engagement into the queue, for the creative agent. Idempotent per 4-hour UTC window. */
  async engagementSweep(ctx: WriteContext, now = Date.now()) {
    const date = new Date(now).toISOString().slice(0, 10)
    const window = String(Math.floor(new Date(now).getUTCHours() / 4) * 4).padStart(2, '0')
    const p = await this.store.collection<{ id: string; value: { handles?: Record<string, string> } }>('profiles').get('main')
    const instagram = Object.entries(p?.value.handles ?? {}).filter(([k, v]) => k.startsWith('instagram') && v.trim()).map(([, v]) => v)
    const ig = instagram.length ? instagram.join(' and ') : 'the Instagram accounts in the profile'
    const body = `Engagement sweep for ${date}, ${window}:00 UTC window. Read new comments, replies, mentions and messages on TikTok (TikTok Studio → Comments and notifications), Threads (replies, mentions and messages) and Instagram (${ig}: comments, DMs and message requests), read-only.\n\nUse a browser session or connection that is already signed in. Never type a password or a two-factor code; if a sign-in is needed, stop and ask the creator. During a sweep only read: do not reply, like, follow, message or change any setting.\n\nBefore drafting for anyone, check whether the creator already answered: her reply under their comment, or an existing DM conversation with them. If she did, add the item with status dismissed, no draft, and a note "Already replied by the creator, <date>" or "Already DM'd by the creator, <date>", so nobody answers them twice. For each person who still needs an answer, add one engagement item (POST /api/engagement-queue: platform tiktok, threads or instagram, account = the creator's handle it came in on, author, comment, sourcePost = link to the post, comment or thread, category, draftReply in the creator's voice). Skip anyone already in the queue for the same post or thread (GET /api/engagement-queue). Sensitive items get category sensitive and no draft. Spam gets category spam. If several sweep requests are waiting, do one sweep and ack them all.\n\nKeyword campaigns: read GET /api/keywords and GET /api/resources. When a comment contains an active campaign's keyword (whole word, any case) on one of its postUrls (any post when postUrls is empty), set keyword to that keyword and draftReply to the campaign's replyTemplate with {name} replaced by the commenter's first name or handle. That reply is delivered as a DM using only the campaign's resource link; promise nothing else.\n\nSending is never part of a sweep. Send a reply only when the creator has approved that exact item (status approved) and told you to send it, and only after checking your conversation with that person: if the creator already messaged them, do not send and add "Not sent: already DM'd by the creator, <date>" to the note. Otherwise send it, then add "Sent by the creative agent, <time>" to its note and leave marking it posted to the creator.`
    return this.system(ctx, `H-SWEEP-${date}-${window}`, { contentItemId: `AUDIT-${date}`, from: 'creator', to: 'creative', type: 'question', body, refs: [] }, 'engagement_sweep')
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

  @Post('weekly-refresh')
  weekly(@Writer() w: WriteContext) {
    return this.handoffs.weeklyRefresh(w)
  }

  @Post('engagement-sweep')
  sweep(@Writer() w: WriteContext) {
    return this.handoffs.engagementSweep(w)
  }

  @Post('x-refresh')
  xRefresh(@Writer() w: WriteContext) {
    return this.handoffs.xRefresh(w)
  }
}

@Module({ imports: [EventsModule], controllers: [HandoffsController, DispatchController], providers: [HandoffsService], exports: [HandoffsService] })
export class HandoffsModule {}
