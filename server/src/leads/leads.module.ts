import { Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post } from '@nestjs/common'
import { Writer, type WriteContext } from '../common/actor'
import { CollectionService } from '../common/collection.service'
import { checkLead } from '../common/draft-only'
import { CreateLeadDto, UpdateLeadDto, type Lead } from '@growth-os/contracts'

@Injectable()
export class LeadsService extends CollectionService<Lead> {
  protected readonly collectionName = 'leads'
  protected readonly idPrefix = 'L'

  protected defaults(): Omit<Lead, 'id'> {
    return { handle: '', platform: 'other', type: 'client_inquiry', status: 'new', summary: '', nextStep: '', source: '', revenueEvidence: '', createdAt: new Date().toISOString().slice(0, 10) }
  }

  protected checkWrite(ctx: WriteContext, prev: Lead | null, next: Lead) {
    checkLead(ctx.actor, prev, next)
  }
}

@Controller('api/leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list() {
    return this.leads.list()
  }

  @Post()
  create(@Writer() w: WriteContext, @Body() body: CreateLeadDto) {
    return this.leads.create(w, body)
  }

  @Patch(':id')
  update(@Writer() w: WriteContext, @Param('id') id: string, @Body() body: UpdateLeadDto) {
    return this.leads.update(w, id, body)
  }

  @Delete(':id')
  remove(@Writer() w: WriteContext, @Param('id') id: string) {
    return this.leads.remove(w, id)
  }
}

@Module({ controllers: [LeadsController], providers: [LeadsService], exports: [LeadsService] })
export class LeadsModule {}
