import { Body, Controller, Delete, ForbiddenException, Get, Inject, Injectable, Module, Param, Patch, Post, Put, ValidationPipe } from '@nestjs/common'
import { isCreator, Writer, type WriteContext } from '../common/actor'
import { CollectionService, stamp } from '../common/collection.service'
import {
  CreateCheckInDto,
  CreateKeywordDto,
  CreateReportDto,
  CreateTaskDto,
  SettingsDto,
  UpdateCheckInDto,
  UpdateKeywordDto,
  UpdateReportDto,
  UpdateTaskDto,
  type AudienceReport,
  type BaseDoc,
  type CheckIn,
  type KeywordRule,
  type Settings,
  type Singleton,
  type Task,
} from '@growth-os/contracts'
import { VALIDATION } from '../common/validation'
import { AuditService } from '../db/audit.service'
import { Store } from '../db/store'

const today = () => new Date().toISOString().slice(0, 10)

@Injectable()
export class KeywordsService extends CollectionService<KeywordRule> {
  protected readonly collectionName = 'keywords'
  protected readonly idPrefix = 'K'
  protected defaults(): Omit<KeywordRule, 'id'> {
    return { keyword: '', approvedResource: '', deliveryMethod: '', cta: '', replyTemplate: '', active: false }
  }
}

@Injectable()
export class TasksService extends CollectionService<Task> {
  protected readonly collectionName = 'tasks'
  protected readonly idPrefix = 'T'
  protected defaults(_: Partial<Task>, ctx: WriteContext): Omit<Task, 'id'> {
    return { title: '', owner: ctx.actor.role === 'worker' ? 'creator' : ctx.actor.role, date: today(), done: false, nextSmallestAction: '' }
  }
}

@Injectable()
export class CheckInsService extends CollectionService<CheckIn> {
  protected readonly collectionName = 'checkins'
  protected readonly idPrefix = 'CI'
  protected defaults(): Omit<CheckIn, 'id'> {
    return { date: today(), kind: 'morning', fields: {} }
  }
}

@Injectable()
export class ReportsService extends CollectionService<AudienceReport> {
  protected readonly collectionName = 'reports'
  protected readonly idPrefix = 'R'
  protected defaults(): Omit<AudienceReport, 'id'> {
    return { weekOf: today(), repeatedQuestions: '', evidence: '', objections: '', requestedTopics: '', businessSignals: '', opportunities: '', limitations: '' }
  }
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly store: Store,
    private readonly audit: AuditService,
  ) {}

  private get repo() {
    return this.store.collection<Singleton<Settings>>('settings')
  }

  async get(): Promise<Settings | null> {
    return (await this.repo.get('main'))?.value ?? null
  }

  async put(ctx: WriteContext, value: Settings) {
    if (!isCreator(ctx.actor)) throw new ForbiddenException('Only the creator edits settings.')
    const prev = await this.repo.get('main')
    const doc = { id: 'main', value, _meta: stamp(ctx, prev?._meta) }
    if (!(await this.repo.replace(doc))) await this.repo.insert(doc)
    await this.audit.record(ctx, prev ? 'update' : 'create', 'settings', 'main')
    return value
  }
}

/** List/create/update/delete routes for the dashboard's planning collections. Bodies are validated against the given DTOs. */
function crud<T extends BaseDoc>(path: string, service: new (...a: never[]) => CollectionService<T>, create: new () => object, update: new () => object) {
  @Controller(`api/${path}`)
  class CrudController {
    constructor(@Inject(service) readonly service: CollectionService<T>) {}

    @Get()
    list() {
      return this.service.list()
    }

    @Post()
    create(@Writer() w: WriteContext, @Body(new ValidationPipe({ ...VALIDATION, expectedType: create })) body: object) {
      return this.service.create(w, body as never)
    }

    @Patch(':id')
    update(@Writer() w: WriteContext, @Param('id') id: string, @Body(new ValidationPipe({ ...VALIDATION, expectedType: update })) body: object) {
      return this.service.update(w, id, body as never)
    }

    @Delete(':id')
    remove(@Writer() w: WriteContext, @Param('id') id: string) {
      return this.service.remove(w, id)
    }
  }
  return CrudController
}

export const KeywordsController = crud('keywords', KeywordsService, CreateKeywordDto, UpdateKeywordDto)
export const TasksController = crud('tasks', TasksService, CreateTaskDto, UpdateTaskDto)
export const CheckInsController = crud('checkins', CheckInsService, CreateCheckInDto, UpdateCheckInDto)
export const ReportsController = crud('reports', ReportsService, CreateReportDto, UpdateReportDto)

@Controller('api/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.get()
  }

  @Put()
  put(@Writer() w: WriteContext, @Body() body: SettingsDto) {
    return this.settings.put(w, body)
  }
}

const SERVICES = [KeywordsService, TasksService, CheckInsService, ReportsService, SettingsService]

@Module({
  controllers: [KeywordsController, TasksController, CheckInsController, ReportsController, SettingsController],
  providers: SERVICES,
  exports: SERVICES,
})
export class WorkspaceModule {}
