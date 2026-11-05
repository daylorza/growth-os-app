import { useSyncExternalStore } from 'react'
import { PRIVATE_WORKSPACE } from './private'
import { createSeed, migrateState, type Migrations } from './seed'
import type { AppState, CollectionKey } from './types'

const KEY = 'growth-os:v1'
/** Storage keys used by older builds, listed in the private workspace's migrations. */
const LEGACY_KEYS = (PRIVATE_WORKSPACE as { migrations?: Migrations } | undefined)?.migrations?.storageKeys ?? []

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY) ?? LEGACY_KEYS.map((k) => localStorage.getItem(k)).find(Boolean)
    if (raw) {
      const parsed = JSON.parse(raw) as AppState
      if (parsed.version === 1) return migrateState(parsed as AppState & Record<string, unknown>, createSeed())
    }
  } catch {
    /* fall through to a fresh seed */
  }
  return createSeed()
}

let state: AppState = typeof localStorage === 'undefined' ? createSeed() : load()
const listeners = new Set<() => void>()

function commit(next: AppState) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* storage full or unavailable: keep in memory */
  }
  listeners.forEach((l) => l())
}

export const useAppState = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )

export const getState = () => state

export const update = (fn: (s: AppState) => AppState) => commit(fn(state))

type Item<K extends CollectionKey> = AppState[K][number]

export function upsert<K extends CollectionKey>(key: K, item: Item<K>) {
  update((s) => {
    const list = s[key] as Item<K>[]
    const exists = list.some((i) => i.id === item.id)
    return { ...s, [key]: exists ? list.map((i) => (i.id === item.id ? item : i)) : [...list, item] }
  })
}

export function patch<K extends CollectionKey>(key: K, id: string, changes: Partial<Item<K>>) {
  update((s) => ({
    ...s,
    [key]: (s[key] as Item<K>[]).map((i) => (i.id === id ? { ...i, ...changes } : i)),
  }))
}

export function remove<K extends CollectionKey>(key: K, id: string) {
  update((s) => ({ ...s, [key]: (s[key] as Item<K>[]).filter((i) => i.id !== id) }))
}

const COLLECTIONS: CollectionKey[] = [
  'content',
  'engagements',
  'keywords',
  'snapshots',
  'experiments',
  'reports',
  'leads',
  'tasks',
  'checkins',
  'handoffs',
]

export const hasDemoData = (s: AppState) =>
  COLLECTIONS.some((k) => (s[k] as { demo?: boolean }[]).some((i) => i.demo))

export function clearDemoData() {
  update((s) => {
    const next = { ...s }
    for (const k of COLLECTIONS) (next as Record<string, unknown>)[k] = (s[k] as { demo?: boolean }[]).filter((i) => !i.demo)
    return next
  })
}

export const exportJSON = () => JSON.stringify(state, null, 2)

export function importJSON(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as AppState
    if (parsed.version !== 1 || !Array.isArray(parsed.content)) return 'That file is not a Growth OS export.'
    commit(migrateState(parsed as AppState & Record<string, unknown>, createSeed()))
    return null
  } catch {
    return 'That file is not valid JSON.'
  }
}

export const resetAll = (seed: AppState = createSeed()) => commit(seed)
