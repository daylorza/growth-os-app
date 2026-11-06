import { Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Put } from '@nestjs/common'
import { isCreator, Writer, type WriteContext } from '../common/actor'
import { stamp } from '../common/collection.service'
import { ProfileDto, type Profile, type Singleton } from '@growth-os/contracts'
import { AuditService } from '../db/audit.service'
import { Store } from '../db/store'

const ID = 'main'

@Injectable()
export class ProfilesService {
  constructor(
    private readonly store: Store,
    private readonly audit: AuditService,
  ) {}

  private get repo() {
    return this.store.collection<Singleton<Profile>>('profiles')
  }

  async find(): Promise<Profile | null> {
    return (await this.repo.get(ID))?.value ?? null
  }

  async get(): Promise<Profile> {
    const p = await this.find()
    if (!p) throw new NotFoundException('No profile yet. Run the one-time migration.')
    return p
  }

  async put(ctx: WriteContext, value: Profile) {
    if (!isCreator(ctx.actor)) throw new ForbiddenException('Only the creator edits the profile.')
    const handles = Object.fromEntries(Object.entries(value.handles ?? {}).filter(([, v]) => typeof v === 'string'))
    const prev = await this.repo.get(ID)
    // Keep a stored master prompt when the dashboard sends a profile without one.
    const doc: Singleton<Profile> = { id: ID, value: { ...value, handles, masterPrompt: value.masterPrompt ?? prev?.value.masterPrompt }, _meta: stamp(ctx, prev?._meta) }
    if (!(await this.repo.replace(doc))) await this.repo.insert(doc)
    await this.audit.record(ctx, prev ? 'update' : 'create', 'profiles', ID)
    return doc.value
  }
}

@Controller('api/profile')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  get() {
    return this.profiles.get()
  }

  @Put()
  put(@Writer() w: WriteContext, @Body() body: ProfileDto) {
    return this.profiles.put(w, body)
  }
}

@Module({ controllers: [ProfilesController], providers: [ProfilesService], exports: [ProfilesService] })
export class ProfilesModule {}
