import { Body, Controller, ForbiddenException, Get, Injectable, Module, Patch } from '@nestjs/common'
import { Writer, type WriteContext } from '../common/actor'
import { RuleViolation, stamp } from '../common/collection.service'
import { checkVerified } from '../common/draft-only'
import { BRIEF_KEYS, BriefFieldDto, canWrite, PatchBriefDto, UNKNOWN, toKnownText, type BaseDoc, type BriefField, type BriefKey } from '@growth-os/contracts'
import { AuditService } from '../db/audit.service'
import { Store } from '../db/store'

export { BRIEF_KEYS }
export type Brief = Record<BriefKey, BriefField>

type BriefDoc = BaseDoc & BriefField

/** Each brief field is its own document: value, verified flag, source. Blank stays UNKNOWN; UNKNOWN is never verified. */
@Injectable()
export class BriefService {
  constructor(
    private readonly store: Store,
    private readonly audit: AuditService,
  ) {}

  private get repo() {
    return this.store.collection<BriefDoc>('brief')
  }

  async get(): Promise<Brief> {
    const docs = new Map((await this.repo.list()).map((d) => [d.id, d]))
    return Object.fromEntries(
      BRIEF_KEYS.map((k) => {
        const d = docs.get(k)
        const value = toKnownText(d?.value)
        return [k, { value, verified: value !== UNKNOWN && !!d?.verified, ...(d?.source ? { source: d.source } : {}) }]
      }),
    ) as Brief
  }

  async patch(ctx: WriteContext, fields: BriefFieldDto[]) {
    if (!canWrite(ctx.actor.role, 'brief')) throw new ForbiddenException('Only the creator edits the approved brief.')
    for (const { key: id, ...change } of fields) {
      const prev = await this.repo.get(id)
      const value = toKnownText(change.value ?? prev?.value)
      const verified = value !== UNKNOWN && (change.verified ?? prev?.verified ?? false)
      try {
        checkVerified(ctx.actor, prev?.verified, verified)
      } catch (e) {
        if (e instanceof RuleViolation) throw new ForbiddenException(e.message)
        throw e
      }
      const doc: BriefDoc = { id, value, verified, source: change.source ?? prev?.source ?? ctx.source, _meta: stamp(ctx, prev?._meta) }
      if (!(await this.repo.replace(doc))) await this.repo.insert(doc)
      await this.audit.record(ctx, prev ? 'update' : 'create', 'brief', id)
    }
    return this.get()
  }
}

@Controller('api/brief')
export class BriefController {
  constructor(private readonly brief: BriefService) {}

  @Get()
  get() {
    return this.brief.get()
  }

  @Patch()
  patch(@Writer() w: WriteContext, @Body() body: PatchBriefDto) {
    return this.brief.patch(w, body.fields)
  }
}

@Module({ controllers: [BriefController], providers: [BriefService], exports: [BriefService] })
export class BriefModule {}
