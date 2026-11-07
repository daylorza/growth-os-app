import type { Role } from './domain'

/**
 * Who may write each collection. Everyone authenticated may read everything.
 * The creator may write anything (she approves and corrects). A write outside this table returns 403.
 */
export const WRITE_ACCESS = {
  /** The creative agent only for its own platforms (CREATIVE_PLATFORMS), checked in the audience service. */
  audience_snapshots: ['creator', 'analyst', 'creative'],
  /** The creative agent only for CREATIVE_PLATFORMS, checked in the engagement service. */
  engagement_queue: ['creator', 'analyst', 'creative'],
  experiments: ['creator', 'analyst'],
  reports: ['creator', 'analyst'],
  leads: ['creator', 'analyst'],
  briefs: ['creator', 'creative'],
  hooks: ['creator', 'creative'],
  scripts: ['creator', 'creative'],
  captions: ['creator', 'creative'],
  /** Both agents, only as themselves. */
  handoffs: ['creator', 'analyst', 'creative'],
  /** The shared id everything hangs off: both create, the API owns ids and status rules. */
  content_items: ['creator', 'analyst', 'creative'],
  tasks: ['creator', 'analyst', 'creative'],
  profiles: ['creator'],
  brief: ['creator'],
  settings: ['creator'],
  keywords: ['creator'],
  checkins: ['creator'],
  tiktok_vault: ['creator'],
  migrations: ['creator'],
} as const satisfies Record<string, readonly Role[]>

export type OwnedCollection = keyof typeof WRITE_ACCESS

export const canWrite = (role: Role, collection: OwnedCollection) => (WRITE_ACCESS[collection] as readonly Role[]).includes(role)
