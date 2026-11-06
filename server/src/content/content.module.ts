import { Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post } from '@nestjs/common'
import { CreateContentDto, DecisionDto, UpdateContentDto, type ContentItem, type Decision, type Handoff, type NextStep, type Owner } from '@growth-os/contracts'
import { Writer, type WriteContext } from '../common/actor'
import { CollectionService } from '../common/collection.service'
import { checkContent } from '../common/draft-only'
import { CreativeModule, BriefsService, CaptionsService, HooksService, ScriptsService } from '../creative/creative.module'
import { AuditService } from '../db/audit.service'
import { Store } from '../db/store'
import { HandoffsModule, HandoffsService } from '../handoffs/handoffs.module'

@Injectable()
export class ContentService extends CollectionService<ContentItem> {
  protected readonly collectionName = 'content_items'
  protected readonly idPrefix = 'C'

  constructor(
    store: Store,
    audit: AuditService,
    private readonly handoffs: HandoffsService,
  ) {
    super(store, audit)
  }

  protected defaults(_: Partial<ContentItem>, ctx: WriteContext): Omit<ContentItem, 'id'> {
    return {
      title: '',
      owner: ctx.actor.role === 'worker' ? 'creator' : ctx.actor.role,
      status: 'idea',
      platform: 'tiktok',
      plannedDate: new Date().toISOString().slice(0, 10),
      pillar: 'build',
      format: 'Talking head',
      mode: 'spontaneous',
      objective: '',
      audience: '',
      hookCuriosity: '',
      hookOpinion: '',
      hookOutcome: '',
      talkingPoints: '',
      visuals: '',
      caption: '',
      hashtags: '',
      cta: '',
      xAdaptation: '',
      claimSource: '',
      approval: 'pending',
      experimentId: '',
      url: '',
      publishedAt: '',
      metrics: {},
    }
  }

  protected checkWrite(ctx: WriteContext, prev: ContentItem | null, next: ContentItem) {
    checkContent(ctx.actor, prev, next)
  }

  /** Agent-facing create: the API owns ids, so any id in the body is ignored. */
  createItem(ctx: WriteContext, input: Partial<ContentItem>) {
    const { id: _ignored, ...rest } = input
    return this.create(ctx, rest)
  }

  /** The creator logs a post she published herself; the analyst is asked to measure it (post_published). */
  async update(ctx: WriteContext, id: string, changes: Partial<ContentItem>) {
    const prev = await this.get(id)
    const next = await super.update(ctx, id, { ...changes, ...(changes.status === 'published' && !changes.publishedAt && !prev.publishedAt ? { publishedAt: new Date().toISOString() } : {}) })
    if (next.status === 'published' && prev.status !== 'published')
      await this.handoffs.system(ctx, `H-PUBLISHED-${id}`, { contentItemId: id, from: 'creator', to: 'analyst', type: 'question', body: `Published by the creator: ${next.url}. Measure at 24h and 72h.`, refs: [{ collection: 'content_items', id }] }, 'post_published')
    return next
  }
}

const latestOf = (hs: Handoff[], pred: (h: Handoff) => boolean) => [...hs].reverse().find(pred) ?? null

/** Next step, decisions and the thread: the normalised view of one content item. */
@Injectable()
export class WorkflowService {
  constructor(
    private readonly content: ContentService,
    private readonly handoffs: HandoffsService,
    private readonly briefs: BriefsService,
    private readonly hooks: HooksService,
    private readonly scripts: ScriptsService,
    private readonly captions: CaptionsService,
  ) {}

  async thread(id: string) {
    await this.content.get(id)
    return this.handoffs.thread(id)
  }

  async nextStep(id: string): Promise<NextStep> {
    const contentItem = await this.content.get(id)
    const thread = await this.handoffs.thread(id)
    const latestAnalysis = latestOf(thread, (h) => h.from === 'analyst' && h.type === 'analysis')
    const latestResult = latestOf(thread, (h) => h.from === 'analyst' && h.type === 'result')
    const latestBrief = await this.briefs.latest(id)
    const openApprovals = thread.filter((h) => h.to === 'creator' && !h.acknowledgedAt)
    const overdueHandoffs = this.handoffs.overdue(thread)
    return { contentItem, latestAnalysis, latestResult, latestBrief, openApprovals, overdueHandoffs, recommended: recommend(contentItem, latestAnalysis, latestResult, latestBrief) }
  }

  /** The creator's call on an item. Writes a creator handoff to the creative agent; approval sends approval_given. */
  async decide(ctx: WriteContext, id: string, decision: Decision, note = '') {
    const item = await this.content.get(id)
    // Repeating the same call (e.g. a double click) changes nothing and sends nothing new.
    const current = { approve: item.approval === 'approved' && item.status !== 'needs_review', kill: item.status === 'killed', request_changes: false }[decision]
    if (current && !note) {
      const previous = (await this.handoffs.thread(id)).filter((h) => h.from === 'creator' && h.type === 'approval').at(-1)
      if (previous) return { decision, handoff: previous, nextStep: await this.nextStep(id), unchanged: true }
    }
    const status = { approve: 'approved', request_changes: 'changes_requested', kill: 'killed' } as const
    const brief = await this.briefs.decide(ctx, id, status[decision])
    await Promise.all([this.hooks, this.scripts, this.captions].map((s) => s.decide(ctx, id, status[decision])))
    const changes: Partial<ContentItem> =
      decision === 'approve' ? { approval: 'approved', status: 'approved' } : decision === 'kill' ? { status: 'killed' } : { approval: 'changes_requested', status: 'needs_review' }
    await this.content.update(ctx, id, item.status === 'published' && decision !== 'kill' ? {} : changes)
    const words = { approve: 'Approved', request_changes: 'Changes requested', kill: 'Killed' }[decision]
    const h = await this.handoffs.system(
      ctx,
      `H-DECISION-${id}-${Date.now()}`,
      { contentItemId: id, from: 'creator', to: 'creative', type: 'approval', body: `${words}: ${id}${brief ? ` (brief ${brief.id})` : ''}.${note ? `\n\n${note}` : ''}`, refs: brief ? [{ collection: 'briefs', id: brief.id }] : [] },
      decision === 'approve' ? 'approval_given' : undefined,
    )
    return { decision, handoff: h.handoff, nextStep: await this.nextStep(id) }
  }
}

/** One recommended action and its owner, from where the thread stands. */
export function recommend(item: ContentItem, analysis: Handoff | null, result: Handoff | null, brief: { status: string; createdAt: string; id: string } | null): { action: string; owner: Owner } {
  if (item.status === 'killed') return { action: 'Nothing. This item was killed.', owner: 'creator' }
  if (item.status === 'published')
    return result && (!brief || result.createdAt > brief.createdAt)
      ? { action: `Read ${result.id} and write the next brief, citing it.`, owner: 'creative' }
      : { action: 'Measure the post at 24h and 72h and log the result.', owner: 'analyst' }
  if (!analysis && !result) return { action: 'Write an analysis that cites recent snapshots and experiments.', owner: 'analyst' }
  const source = [analysis, result].filter((h): h is Handoff => !!h).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (!brief || brief.status === 'changes_requested' || brief.createdAt < source.createdAt) return { action: `Write a brief that cites ${source.id}.`, owner: 'creative' }
  if (brief.status === 'draft') return { action: `Review brief ${brief.id}: approve, request changes or kill.`, owner: 'creator' }
  return { action: 'Film and publish it yourself, then log the live URL.', owner: 'creator' }
}

@Controller('api/content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get()
  list() {
    return this.content.list()
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.content.get(id)
  }

  @Post()
  create(@Writer() w: WriteContext, @Body() body: CreateContentDto) {
    return this.content.create(w, body as Partial<ContentItem>)
  }

  @Patch(':id')
  update(@Writer() w: WriteContext, @Param('id') id: string, @Body() body: UpdateContentDto) {
    return this.content.update(w, id, body as Partial<ContentItem>)
  }

  @Delete(':id')
  remove(@Writer() w: WriteContext, @Param('id') id: string) {
    return this.content.remove(w, id)
  }
}

/** Agent-facing view of content items: the shared id, its thread and its next step. */
@Controller('api/content-items')
export class ContentItemsController {
  constructor(
    private readonly content: ContentService,
    private readonly workflow: WorkflowService,
  ) {}

  @Get()
  list() {
    return this.content.list()
  }

  @Post()
  create(@Writer() w: WriteContext, @Body() body: CreateContentDto) {
    return this.content.createItem(w, body as Partial<ContentItem>)
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.content.get(id)
  }

  @Get(':id/handoffs')
  thread(@Param('id') id: string) {
    return this.workflow.thread(id)
  }

  @Get(':id/next-step')
  nextStep(@Param('id') id: string) {
    return this.workflow.nextStep(id)
  }

  @Post(':id/decision')
  decide(@Writer() w: WriteContext, @Param('id') id: string, @Body() body: DecisionDto) {
    return this.workflow.decide(w, id, body.decision, body.note)
  }
}

@Module({
  imports: [HandoffsModule, CreativeModule],
  controllers: [ContentController, ContentItemsController],
  providers: [ContentService, WorkflowService],
  exports: [ContentService, WorkflowService],
})
export class ContentModule {}
