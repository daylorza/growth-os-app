import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post } from '@nestjs/common'
import { CreateExperimentDto, UpdateExperimentDto, type Experiment } from '@growth-os/contracts'
import { Writer, type WriteContext } from '../common/actor'
import { CollectionService } from '../common/collection.service'
import { AuditService } from '../db/audit.service'
import { Store } from '../db/store'
import { HandoffsModule, HandoffsService } from '../handoffs/handoffs.module'

/** Experiment log. When the analyst logs a result, the creative agent is told (experiment_logged). */
@Injectable()
export class ExperimentsService extends CollectionService<Experiment> {
  protected readonly collectionName = 'experiments'
  protected readonly idPrefix = 'X'

  constructor(
    store: Store,
    audit: AuditService,
    private readonly handoffs: HandoffsService,
  ) {
    super(store, audit)
  }

  protected defaults(): Omit<Experiment, 'id'> {
    return { hypothesis: '', change: '', audiencePillar: '', posts: '', primaryMetric: '', baseline: '', window: '', result: '', confidence: '', nextAction: '', status: 'planned' }
  }

  async create(ctx: WriteContext, input: Partial<Experiment>) {
    if (ctx.actor.role === 'analyst' && !input.contentItemId) throw new BadRequestException('Name the contentItemId this result was measured on.')
    if (input.contentItemId && !(await this.store.collection('content_items').get(input.contentItemId))) throw new BadRequestException(`Content item ${input.contentItemId} does not exist.`)
    const x = await super.create(ctx, input)
    if (ctx.actor.role === 'analyst' && x.contentItemId)
      await this.handoffs.send(ctx, {
        contentItemId: x.contentItemId,
        from: 'analyst',
        to: 'creative',
        type: 'result',
        body: `Experiment ${x.id} logged for ${x.contentItemId}.${x.result ? `\n\nResult: ${x.result}` : ''}${x.nextAction ? `\n\nNext: ${x.nextAction}` : ''}`,
        refs: [{ collection: 'experiments', id: x.id }],
      })
    return x
  }
}

@Controller('api/experiments')
export class ExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  @Get()
  list() {
    return this.experiments.list()
  }

  @Post()
  create(@Writer() w: WriteContext, @Body() body: CreateExperimentDto) {
    return this.experiments.create(w, body)
  }

  @Patch(':id')
  update(@Writer() w: WriteContext, @Param('id') id: string, @Body() body: UpdateExperimentDto) {
    return this.experiments.update(w, id, body)
  }

  @Delete(':id')
  remove(@Writer() w: WriteContext, @Param('id') id: string) {
    return this.experiments.remove(w, id)
  }
}

@Module({ imports: [HandoffsModule], controllers: [ExperimentsController], providers: [ExperimentsService], exports: [ExperimentsService] })
export class ExperimentsModule {}
