import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, Post, Req } from '@nestjs/common'
import {
  BRIEF_KEYS,
  CreateCheckInDto,
  CreateContentDto,
  CreateEngagementDto,
  CreateExperimentDto,
  CreateHandoffDto,
  CreateKeywordDto,
  CreateResourceDto,
  CreateLeadDto,
  CreateReportDto,
  CreateSnapshotDto,
  CreateTaskDto,
  ImportDto,
  ProfileDto,
  SettingsDto,
  TikTokVaultDto,
  type AudienceSnapshot,
  type BaseDoc,
} from '@growth-os/contracts'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { createHash } from 'node:crypto'
import { AudienceModule, AudienceService, normalizeMetrics } from '../audience/audience.module'
import { BriefModule, BriefService } from '../brief/brief.module'
import { isCreator, Writer, type AuthedRequest, type WriteContext } from '../common/actor'
import type { CollectionService } from '../common/collection.service'
import { ContentModule, ContentService } from '../content/content.module'
import { AuditService } from '../db/audit.service'
import { Store } from '../db/store'
import { EngagementModule, EngagementService } from '../engagement/engagement.module'
import { ExperimentsModule, ExperimentsService } from '../experiments/experiments.module'
import { HandoffsModule, HandoffsService } from '../handoffs/handoffs.module'
import { LeadsModule, LeadsService } from '../leads/leads.module'
import { ProfilesModule, ProfilesService } from '../profiles/profiles.module'
import { CheckInsService, KeywordsService, ReportsService, ResourcesService, SettingsService, TasksService, WorkspaceModule } from '../workspace/workspace.module'

interface Receipt extends BaseDoc {
  at: string
  by: string
  label: string
  sha256: string
  results: Record<string, { inserted: string[]; skipped: string[] }>
}

const validated = <T extends object>(cls: new () => T, raw: object, where: string): T => {
  const inst = plainToInstance(cls, raw)
  const errors = validateSync(inst, { whitelist: true, forbidNonWhitelisted: true })
  if (errors.length) throw new BadRequestException(`${where}: ${errors.map((e) => Object.values(e.constraints ?? { nested: `${e.property} is invalid` }).join(', ')).join('; ')}`)
  return inst
}

/** Older dashboard handoffs used itemId/message/acknowledged. */
const toHandoff = (raw: Record<string, unknown>): object => {
  if (!('itemId' in raw) && !('message' in raw)) return raw
  const { itemId, message, acknowledged: _a, ...rest } = raw
  return { ...rest, contentItemId: itemId, body: message, type: rest.type ?? 'question', refs: rest.refs ?? [] }
}
const ackOf = (raw: Record<string, unknown>) =>
  raw.acknowledged === true || raw.acknowledgedAt ? { acknowledgedAt: (raw.acknowledgedAt as string) ?? (raw.createdAt as string) ?? new Date().toISOString(), acknowledgedBy: (raw.acknowledgedBy as string) ?? raw.to } : {}

/** Dashboard snapshots carry `count`; the endpoint stores full metrics. */
const toSnapshot = (raw: Record<string, unknown>): object => {
  if (raw.metrics) return raw
  const { count, ...rest } = raw
  return { ...rest, sourceType: 'manual', metrics: { followers: count } }
}

@Injectable()
export class StateService {
  constructor(
    private readonly store: Store,
    private readonly audit: AuditService,
    private readonly profiles: ProfilesService,
    private readonly brief: BriefService,
    private readonly settings: SettingsService,
    private readonly audience: AudienceService,
    private readonly content: ContentService,
    private readonly handoffs: HandoffsService,
    private readonly experiments: ExperimentsService,
    private readonly engagement: EngagementService,
    private readonly leads: LeadsService,
    private readonly keywords: KeywordsService,
    private readonly resources: ResourcesService,
    private readonly tasks: TasksService,
    private readonly checkins: CheckInsService,
    private readonly reports: ReportsService,
  ) {}

  /** Everything the dashboard needs in one read. */
  async state() {
    const [profile, brief, settings, content, engagements, keywords, resources, snapshots, experiments, reports, leads, tasks, checkins, handoffs, tiktokVault] = await Promise.all([
      this.profiles.find(),
      this.brief.get(),
      this.settings.get(),
      this.content.list(),
      this.engagement.list(),
      this.keywords.list(),
      this.resources.list(),
      this.audience.list(),
      this.experiments.list(),
      this.reports.list(),
      this.leads.list(),
      this.tasks.list(),
      this.checkins.list(),
      this.handoffs.list(),
      this.audience.getVault(),
    ])
    return { initialized: !!profile, profile, brief, settings, content, engagements, keywords, resources, snapshots, experiments, reports, leads, tasks, checkins, handoffs, tiktokVault }
  }

  /** One-time import. Existing ids are never overwritten; the receipt lists what was inserted and skipped. */
  async import(ctx: WriteContext, body: ImportDto) {
    if (!isCreator(ctx.actor)) throw new ForbiddenException('Only the creator runs a migration.')
    const results: Receipt['results'] = {}
    const note = (key: string, id: string, r: 'inserted' | 'skipped') => {
      results[key] ??= { inserted: [], skipped: [] }
      results[key][r].push(id)
    }

    // Validate everything before writing anything.
    const profile = body.profile ? validated(ProfileDto, { ...body.profile, ...(body.masterPrompt ? { masterPrompt: body.masterPrompt } : {}) }, 'profile') : undefined
    const settings = body.settings ? validated(SettingsDto, body.settings, 'settings') : undefined
    const vault = body.tiktokVault ? validated(TikTokVaultDto, body.tiktokVault, 'tiktokVault') : undefined
    const lists: [keyof ImportDto, CollectionService<never>, new () => object, (raw: Record<string, unknown>) => object][] = [
      ['content', this.content as never, CreateContentDto, (r) => r],
      ['engagements', this.engagement as never, CreateEngagementDto, (r) => r],
      ['keywords', this.keywords as never, CreateKeywordDto, (r) => r],
      ['resources', this.resources as never, CreateResourceDto, (r) => r],
      ['snapshots', this.audience as never, CreateSnapshotDto, toSnapshot],
      ['experiments', this.experiments as never, CreateExperimentDto, (r) => r],
      ['reports', this.reports as never, CreateReportDto, (r) => r],
      ['leads', this.leads as never, CreateLeadDto, (r) => r],
      ['tasks', this.tasks as never, CreateTaskDto, (r) => r],
      ['checkins', this.checkins as never, CreateCheckInDto, (r) => r],
      ['handoffs', this.handoffs as never, CreateHandoffDto, toHandoff],
    ]
    const planned = lists.flatMap(([key, service, dto, map]) =>
      ((body[key] as Record<string, unknown>[] | undefined) ?? []).map((raw, i) => {
        const { _meta: _m, acknowledgedAt: _x, acknowledgedBy: _y, ...clean } = map(raw) as Record<string, unknown>
        const item: Record<string, unknown> = { ...(validated(dto, clean, `${key}[${i}]`) as Record<string, unknown>), ...(key === 'handoffs' ? ackOf(raw) : {}) }
        if (typeof item.id !== 'string') throw new BadRequestException(`${key}[${i}]: id is required for import.`)
        if (key === 'snapshots') (item as unknown as AudienceSnapshot).metrics = normalizeMetrics(item.metrics as Record<string, unknown>)
        return { key, service, item }
      }),
    )
    if (body.profile) {
      const existing = await this.profiles.find()
      if (!existing) await this.profiles.put(ctx, profile!)
      else if (body.masterPrompt && !existing.masterPrompt) await this.profiles.put(ctx, { ...existing, masterPrompt: body.masterPrompt })
      note('profiles', 'main', existing ? 'skipped' : 'inserted')
    }
    if (body.settings) {
      const existing = await this.settings.get()
      if (!existing) await this.settings.put(ctx, settings!)
      note('settings', 'main', existing ? 'skipped' : 'inserted')
    }
    if (body.brief) {
      const current = await this.brief.get()
      const fields = Object.entries(body.brief)
        .filter(([k, v]) => (BRIEF_KEYS as readonly string[]).includes(k) && current[k as keyof typeof current].value === 'UNKNOWN' && v?.value?.trim() && v.value !== 'UNKNOWN')
        .map(([key, v]) => ({ key: key as (typeof BRIEF_KEYS)[number], value: v.value, verified: !!v.verified, source: v.source ?? 'migration' }))
      if (fields.length) await this.brief.patch(ctx, fields)
      for (const k of BRIEF_KEYS) if (body.brief[k]) note('brief', k, fields.some((f) => f.key === k) ? 'inserted' : 'skipped')
    }

    for (const { key, service, item } of planned) note(key, item.id as string, await service.importOne(ctx, item as never))

    if (vault) {
      const existing = await this.audience.getVault()
      if (!existing || existing.generatedAt < vault.generatedAt) await this.audience.putVault(ctx, vault)
      note('tiktok_vault', 'latest', !existing || existing.generatedAt < vault.generatedAt ? 'inserted' : 'skipped')
    }

    const at = new Date().toISOString()
    const receipt: Receipt = {
      id: `M-${at}`,
      at,
      by: ctx.actor.name,
      label: body.label ?? ctx.source,
      sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
      results,
    }
    await this.store.collection<Receipt>('migrations').insert(receipt)
    await this.audit.record(ctx, 'import', 'migrations', receipt.id)
    return receipt
  }

  receipts() {
    return this.store.collection<Receipt>('migrations').list()
  }
}

@Controller('api')
export class StateController {
  constructor(private readonly state: StateService) {}

  @Get('session')
  session(@Req() req: AuthedRequest) {
    return { actor: req.actor }
  }

  @Get('state')
  get() {
    return this.state.state()
  }

  @Post('migrations/import')
  import(@Writer() w: WriteContext, @Body() body: ImportDto) {
    return this.state.import(w, body)
  }

  @Get('migrations')
  receipts() {
    return this.state.receipts()
  }
}

@Module({
  imports: [ProfilesModule, BriefModule, AudienceModule, ContentModule, HandoffsModule, ExperimentsModule, EngagementModule, LeadsModule, WorkspaceModule],
  controllers: [StateController],
  providers: [StateService],
})
export class StateModule {}
