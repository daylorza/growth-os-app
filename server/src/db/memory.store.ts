import type { BaseDoc } from '@growth-os/contracts'
import { DuplicateIdError, Store, type CollectionName, type Filter, type Repository } from './store'

const matches = (doc: object, filter: Filter = {}) => Object.entries(filter).every(([k, v]) => (doc as Record<string, unknown>)[k] === v)

class MemoryRepository<T extends BaseDoc> implements Repository<T> {
  private readonly docs = new Map<string, T>()

  async list(filter?: Filter) {
    return [...this.docs.values()].filter((d) => matches(d, filter)).map((d) => structuredClone(d))
  }
  async get(id: string) {
    const d = this.docs.get(id)
    return d ? structuredClone(d) : null
  }
  async insert(doc: T) {
    if (this.docs.has(doc.id)) throw new DuplicateIdError(doc.id)
    this.docs.set(doc.id, structuredClone(doc))
    return structuredClone(doc)
  }
  async replace(doc: T) {
    if (!this.docs.has(doc.id)) return null
    this.docs.set(doc.id, structuredClone(doc))
    return structuredClone(doc)
  }
  async remove(id: string) {
    return this.docs.delete(id)
  }
}

/** In-process store for tests and local development without MongoDB. Not durable. */
export class MemoryStore extends Store {
  private readonly repos = new Map<CollectionName, MemoryRepository<BaseDoc>>()

  collection<T extends BaseDoc>(name: CollectionName): Repository<T> {
    if (!this.repos.has(name)) this.repos.set(name, new MemoryRepository())
    return this.repos.get(name) as unknown as Repository<T>
  }
  async ping() {
    return true
  }
}
