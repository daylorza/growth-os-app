import { BadRequestException, Body, Controller, Delete, Get, Inject, Injectable, Module, Param, Patch, Post, Query, ValidationPipe } from '@nestjs/common'
import {
  CreateCaptionDto,
  CreateCreativeBriefDto,
  CreateHookDto,
  CreateScriptDto,
  UpdateCaptionDto,
  UpdateCreativeBriefDto,
  UpdateHookDto,
  UpdateScriptDto,
  type BaseDoc,
  type Brief,
  type Caption,
  type DraftStatus,
  type Hook,
  type Script,
} from '@growth-os/contracts'
import { isCreator, Writer, type WriteContext } from '../common/actor'
import { CollectionService, RuleViolation } from '../common/collection.service'
import { VALIDATION } from '../common/validation'
import { AuditService } from '../db/audit.service'
import { Store, type CollectionName } from '../db/store'
import { HandoffsModule, HandoffsService } from '../handoffs/handoffs.module'

type CreativeDoc = BaseDoc & { contentItemId: string; status: DraftStatus; createdAt: string }

/** Briefs, hooks, scripts and captions: written by the creative agent as drafts. Only the creator changes their status. */
abstract class CreativeService<T extends CreativeDoc> extends CollectionService<T> {
  protected baseDefaults(): Pick<CreativeDoc, 'status' | 'createdAt'> {
    return { status: 'draft', createdAt: new Date().toISOString() }
  }

  protected checkWrite(ctx: WriteContext, prev: T | null, next: T) {
    if (!isCreator(ctx.actor) && next.status !== 'draft' && next.status !== prev?.status) throw new RuleViolation('Agents write drafts. Only the creator approves, requests changes or kills.', 'forbidden')
    if (prev && prev.contentItemId !== next.contentItemId) throw new RuleViolation('contentItemId cannot change.')
  }

  async create(ctx: WriteContext, input: Partial<T>) {
    this.own(ctx)
    if (!input.contentItemId || !(await this.store.collection('content_items').get(input.contentItemId))) throw new BadRequestException(`Content item ${input.contentItemId ?? ''} does not exist.`)
    return super.create(ctx, input)
  }

  latest(contentItemId: string) {
    return this.list({ contentItemId }).then((xs) => xs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null)
  }

  /** Applies the creator's decision to every draft for the item (killed ones stay killed). Returns the latest. */
  async decide(ctx: WriteContext, contentItemId: string, status: DraftStatus) {
    const docs = await this.list({ contentItemId })
    for (const d of docs) if (d.status !== 'killed' && d.status !== status) await this.update(ctx, d.id, { status } as Partial<T>)
    return this.latest(contentItemId)
  }
}

@Injectable()
export class BriefsService extends CreativeService<Brief> {
  protected readonly collectionName = 'briefs'
  protected readonly idPrefix = 'B'

  constructor(
    store: Store,
    audit: AuditService,
    private readonly handoffs: HandoffsService,
  ) {
    super(store, audit)
  }

  protected defaults(): Omit<Brief, 'id'> {
    return { ...this.baseDefaults(), contentItemId: '', sourceHandoffId: '', objective: '', audience: '', talkingPoints: '', cta: '', xAdaptation: '', claimSource: '', body: '' }
  }

  /** A brief must cite the analysis it builds on. Writing one hands it to the analyst (brief_created). */
  async create(ctx: WriteContext, input: Partial<Brief>) {
    this.own(ctx)
    const source = input.sourceHandoffId ? await this.handoffs.get(input.sourceHandoffId).catch(() => null) : null
    if (!source || (source.type !== 'analysis' && source.type !== 'result')) throw new BadRequestException('sourceHandoffId must be an analysis or result handoff. No brief without a cited source.')
    const brief = await super.create(ctx, input)
    if (ctx.actor.role === 'creative')
      await this.handoffs.send(ctx, {
        contentItemId: brief.contentItemId,
        from: 'creative',
        to: 'analyst',
        type: 'brief',
        body: `Brief ${brief.id} for ${brief.contentItemId}, built on ${source.id}.${brief.objective ? `\n\nObjective: ${brief.objective}` : ''}`,
        refs: [
          { collection: 'briefs', id: brief.id },
          { collection: 'handoffs', id: source.id },
        ],
      })
    return brief
  }
}

@Injectable()
export class HooksService extends CreativeService<Hook> {
  protected readonly collectionName = 'hooks'
  protected readonly idPrefix = 'HK'
  protected defaults(): Omit<Hook, 'id'> {
    return { ...this.baseDefaults(), contentItemId: '', kind: 'curiosity', text: '' }
  }
}

@Injectable()
export class ScriptsService extends CreativeService<Script> {
  protected readonly collectionName = 'scripts'
  protected readonly idPrefix = 'SC'
  protected defaults(): Omit<Script, 'id'> {
    return { ...this.baseDefaults(), contentItemId: '', body: '' }
  }
}

@Injectable()
export class CaptionsService extends CreativeService<Caption> {
  protected readonly collectionName = 'captions'
  protected readonly idPrefix = 'CP'
  protected defaults(): Omit<Caption, 'id'> {
    return { ...this.baseDefaults(), contentItemId: '', platform: 'tiktok', text: '', hashtags: '' }
  }
}

function routes<T extends CreativeDoc>(path: CollectionName, service: new (...a: never[]) => CreativeService<T>, create: new () => object, update: new () => object) {
  @Controller(`api/${path}`)
  class CreativeController {
    constructor(@Inject(service) readonly service: CreativeService<T>) {}

    @Get()
    list(@Query('contentItemId') contentItemId?: string) {
      return this.service.list(contentItemId ? { contentItemId } : undefined)
    }

    @Post()
    create(@Writer() w: WriteContext, @Body(new ValidationPipe({ ...VALIDATION, expectedType: create })) body: object) {
      return this.service.create(w, body as Partial<T>)
    }

    @Patch(':id')
    update(@Writer() w: WriteContext, @Param('id') id: string, @Body(new ValidationPipe({ ...VALIDATION, expectedType: update })) body: object) {
      return this.service.update(w, id, body as Partial<T>)
    }

    @Delete(':id')
    remove(@Writer() w: WriteContext, @Param('id') id: string) {
      return this.service.remove(w, id)
    }
  }
  return CreativeController
}

export const BriefsController = routes('briefs', BriefsService, CreateCreativeBriefDto, UpdateCreativeBriefDto)
export const HooksController = routes('hooks', HooksService, CreateHookDto, UpdateHookDto)
export const ScriptsController = routes('scripts', ScriptsService, CreateScriptDto, UpdateScriptDto)
export const CaptionsController = routes('captions', CaptionsService, CreateCaptionDto, UpdateCaptionDto)

const SERVICES = [BriefsService, HooksService, ScriptsService, CaptionsService]

@Module({ imports: [HandoffsModule], controllers: [BriefsController, HooksController, ScriptsController, CaptionsController], providers: SERVICES, exports: SERVICES })
export class CreativeModule {}
