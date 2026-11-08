import { Body, Controller, ForbiddenException, Get, Injectable, Module, Param, Patch, Post } from '@nestjs/common'
import { Writer, type WriteContext } from '../common/actor'
import { CollectionService } from '../common/collection.service'
import { checkEngagement } from '../common/draft-only'
import { CREATIVE_ENGAGEMENT_PLATFORMS, CreateEngagementDto, UpdateEngagementDto, type Engagement, type Handoff } from '@growth-os/contracts'

/** Comment queue with draft replies. Nothing here sends a reply; the creator posts it herself. */
@Injectable()
export class EngagementService extends CollectionService<Engagement> {
  protected readonly collectionName = 'engagement_queue'
  protected readonly idPrefix = 'E'

  protected defaults(): Omit<Engagement, 'id'> {
    const now = new Date().toISOString()
    return { platform: 'tiktok', account: '', sourcePost: '', author: '', comment: '', keyword: '', category: 'question', draftReply: '', status: 'new', leadId: '', note: '', createdAt: now, updatedAt: now }
  }

  protected checkWrite(ctx: WriteContext, prev: Engagement | null, next: Engagement) {
    if (ctx.actor.role === 'creative' && ![prev?.platform ?? next.platform, next.platform].every((p) => (CREATIVE_ENGAGEMENT_PLATFORMS as readonly string[]).includes(p)))
      throw new ForbiddenException(`The creative agent queues ${CREATIVE_ENGAGEMENT_PLATFORMS.join(', ')} engagement only.`)
    checkEngagement(ctx.actor, prev, next)
  }

  /** The creative agent marks an item sent only after the creator asked it to send that exact text. */
  async update(ctx: WriteContext, id: string, changes: Partial<Engagement>) {
    if (changes.status === 'sent_by_agent' && ctx.actor.role === 'creative') {
      const prev = await this.get(id)
      const asked = (await this.store.collection<Handoff>('handoffs').list({ to: 'creative' })).some(
        (h) => h.from === 'creator' && h.refs.some((r) => r.collection === 'engagement_queue' && r.id === id) && !!prev.draftReply.trim() && h.body.includes(prev.draftReply),
      )
      if (prev.status !== 'sent_by_agent' && !asked) throw new ForbiddenException(`The creator has not asked you to send this reply on ${id}.`)
    }
    return super.update(ctx, id, changes)
  }
}

@Controller('api/engagement-queue')
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @Get()
  list() {
    return this.engagement.list()
  }

  @Post()
  create(@Writer() w: WriteContext, @Body() body: CreateEngagementDto) {
    return this.engagement.create(w, body)
  }

  @Patch(':id')
  update(@Writer() w: WriteContext, @Param('id') id: string, @Body() body: UpdateEngagementDto) {
    return this.engagement.update(w, id, { ...body, updatedAt: new Date().toISOString() })
  }
}

@Module({ controllers: [EngagementController], providers: [EngagementService], exports: [EngagementService] })
export class EngagementModule {}
