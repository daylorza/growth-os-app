import { Body, Controller, Get, Injectable, Module, Param, Patch, Post } from '@nestjs/common'
import { Writer, type WriteContext } from '../common/actor'
import { CollectionService } from '../common/collection.service'
import { checkEngagement } from '../common/draft-only'
import { CreateEngagementDto, UpdateEngagementDto, type Engagement } from '@growth-os/contracts'

/** Comment queue with draft replies. Nothing here sends a reply; the creator posts it herself. */
@Injectable()
export class EngagementService extends CollectionService<Engagement> {
  protected readonly collectionName = 'engagement_queue'
  protected readonly idPrefix = 'E'

  protected defaults(): Omit<Engagement, 'id'> {
    const now = new Date().toISOString()
    return { platform: 'tiktok', sourcePost: '', author: '', comment: '', keyword: '', category: 'question', draftReply: '', status: 'new', leadId: '', note: '', createdAt: now, updatedAt: now }
  }

  protected checkWrite(ctx: WriteContext, prev: Engagement | null, next: Engagement) {
    checkEngagement(ctx.actor, prev, next)
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
