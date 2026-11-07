import type { BaseDoc } from '@growth-os/contracts'

/** Equality filter on top-level fields. Kept deliberately small so any backend (MongoDB now, SQL later) can serve it. */
export type Filter = Record<string, string | number | boolean>

export class DuplicateIdError extends Error {
  constructor(readonly id: string) {
    super(`An item with id ${id} already exists.`)
  }
}

/** Storage-agnostic access to one collection. Services depend on this, never on a driver. */
export interface Repository<T extends BaseDoc> {
  list(filter?: Filter): Promise<T[]>
  get(id: string): Promise<T | null>
  /** Throws DuplicateIdError if the id exists. */
  insert(doc: T): Promise<T>
  /** Replaces the whole document. Returns null if it does not exist. */
  replace(doc: T): Promise<T | null>
  remove(id: string): Promise<boolean>
}

export const COLLECTIONS = [
  'profiles',
  'brief',
  'settings',
  'audience_snapshots',
  'tiktok_vault',
  'content_items',
  'handoffs',
  'experiments',
  'engagement_queue',
  'leads',
  'keywords',
  'resources',
  'tasks',
  'checkins',
  'reports',
  'briefs',
  'hooks',
  'scripts',
  'captions',
  'events',
  'analytics_facts',
  'audit_log',
  'migrations',
] as const
export type CollectionName = (typeof COLLECTIONS)[number]

export abstract class Store {
  abstract collection<T extends BaseDoc>(name: CollectionName): Repository<T>
  abstract ping(): Promise<boolean>
}
