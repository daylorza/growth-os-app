import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../db/audit.service'
import { DuplicateIdError, Store, type CollectionName, type Filter, type Repository } from '../db/store'
import { isCreator, type WriteContext } from './actor'
import { canWrite, type BaseDoc, type OwnedCollection, type WriteMeta } from '@growth-os/contracts'

/** Next sequential id like C-010. Only ids of exactly that form count (not e.g. H-AUDIT-2026-11-05). */
export const nextId = (prefix: string, existing: { id: string }[]) => {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`)
  const max = existing.reduce((m, e) => {
    const n = Number(pattern.exec(e.id)?.[1])
    return Number.isFinite(n) && n > m ? n : m
  }, 0)
  return `${prefix}-${String(max + 1).padStart(3, '0')}`
}

export const stamp = (ctx: WriteContext, prev?: WriteMeta): WriteMeta => {
  const now = new Date().toISOString()
  const who = { by: ctx.actor.name, role: ctx.actor.role, at: now, source: ctx.source }
  return {
    createdBy: prev?.createdBy ?? who.by,
    createdRole: prev?.createdRole ?? who.role,
    createdAt: prev?.createdAt ?? who.at,
    createdSource: prev?.createdSource ?? who.source,
    updatedBy: who.by,
    updatedRole: who.role,
    updatedAt: who.at,
    updatedSource: who.source,
  }
}

/** Thrown by a collection's rules when a write would break draft-only or evidence rules. */
export class RuleViolation extends Error {
  constructor(
    message: string,
    readonly kind: 'forbidden' | 'invalid' = 'invalid',
  ) {
    super(message)
  }
}

/**
 * Shared create/update/delete for one collection. Every write is stamped with the actor
 * and source, checked against the collection's rules, and recorded in the audit log.
 */
@Injectable()
export abstract class CollectionService<T extends BaseDoc> {
  protected abstract readonly collectionName: CollectionName
  protected abstract readonly idPrefix: string

  constructor(
    protected readonly store: Store,
    protected readonly audit: AuditService,
  ) {}

  protected get repo(): Repository<T> {
    return this.store.collection<T>(this.collectionName)
  }

  /** Fills defaults for a new item. */
  protected abstract defaults(input: Partial<T>, ctx: WriteContext): Omit<T, 'id'>

  /** Throw RuleViolation to reject a write. `prev` is null on create. */
  protected checkWrite(_ctx: WriteContext, _prev: T | null, _next: T): void {}

  /** Collection ownership: a write to another agent's collection is a 403. */
  protected own(ctx: WriteContext) {
    if (!canWrite(ctx.actor.role, this.collectionName as OwnedCollection))
      throw new ForbiddenException(`The ${ctx.actor.role} role cannot write ${this.collectionName}.`)
  }

  protected guard(fn: () => void) {
    try {
      fn()
    } catch (e) {
      if (e instanceof RuleViolation) throw e.kind === 'forbidden' ? new ForbiddenException(e.message) : new BadRequestException(e.message)
      throw e
    }
  }

  list(filter?: Filter) {
    return this.repo.list(filter)
  }

  async get(id: string) {
    const doc = await this.repo.get(id)
    if (!doc) throw new NotFoundException(`${id} not found.`)
    return doc
  }

  async create(ctx: WriteContext, input: Partial<T>): Promise<T> {
    this.own(ctx)
    const { id: requested, _meta: _ignored, ...rest } = input as Partial<T> & BaseDoc
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = requested ?? nextId(this.idPrefix, await this.repo.list())
      const doc = { ...this.defaults(rest as Partial<T>, ctx), ...rest, id, _meta: stamp(ctx) } as T
      this.guard(() => this.checkWrite(ctx, null, doc))
      try {
        await this.repo.insert(doc)
        await this.audit.record(ctx, 'create', this.collectionName, id)
        return doc
      } catch (e) {
        if (!(e instanceof DuplicateIdError)) throw e
        if (requested) throw new ConflictException(e.message)
      }
    }
    throw new ConflictException('Could not allocate an id. Retry.')
  }

  async update(ctx: WriteContext, id: string, changes: Partial<T>): Promise<T> {
    this.own(ctx)
    const prev = await this.get(id)
    const { id: _id, _meta: _m, ...rest } = changes as Partial<T> & BaseDoc
    const next = { ...prev, ...rest, id, _meta: stamp(ctx, prev._meta) } as T
    this.guard(() => this.checkWrite(ctx, prev, next))
    if (!(await this.repo.replace(next))) throw new NotFoundException(`${id} not found.`)
    await this.audit.record(ctx, 'update', this.collectionName, id)
    return next
  }

  /** Only the creator deletes. Agents can draft and edit, never remove. */
  async remove(ctx: WriteContext, id: string) {
    if (!isCreator(ctx.actor)) throw new ForbiddenException('Only the creator can delete items.')
    if (!(await this.repo.remove(id))) throw new NotFoundException(`${id} not found.`)
    await this.audit.record(ctx, 'delete', this.collectionName, id)
    return { deleted: id }
  }

  /** Inserts an item as-is if its id is new. Used by the one-time migration. */
  async importOne(ctx: WriteContext, doc: T): Promise<'inserted' | 'skipped'> {
    if (await this.repo.get(doc.id)) return 'skipped'
    const { _meta: _m, ...rest } = doc as T & BaseDoc
    await this.repo.insert({ ...this.defaults(rest as Partial<T>, ctx), ...rest, _meta: stamp(ctx) } as T)
    await this.audit.record(ctx, 'import', this.collectionName, doc.id)
    return 'inserted'
  }
}
