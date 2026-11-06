import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { WriteContext } from '../common/actor'
import type { BaseDoc } from '@growth-os/contracts'
import { Store, type CollectionName } from './store'

export interface AuditEntry extends BaseDoc {
  at: string
  actor: string
  role: string
  action: 'create' | 'update' | 'delete' | 'import'
  collection: CollectionName
  itemId: string
  source: string
}

/** Append-only log of every write: who, when, what and from where. */
@Injectable()
export class AuditService {
  constructor(private readonly store: Store) {}

  async record(ctx: WriteContext, action: AuditEntry['action'], collection: CollectionName, itemId: string) {
    await this.store.collection<AuditEntry>('audit_log').insert({
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: ctx.actor.name,
      role: ctx.actor.role,
      action,
      collection,
      itemId,
      source: ctx.source,
    })
  }

  list() {
    return this.store.collection<AuditEntry>('audit_log').list()
  }
}
