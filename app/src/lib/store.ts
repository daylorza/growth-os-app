import { createContext, useContext, useSyncExternalStore } from 'react'
import { privateWorkspace, setPrivateData, type PrivateData } from './private'
import { diff, fetchState, fromEndpoint, send, type EndpointState } from './remote'
import { createBlankSeed, createSeed, migrateState, type Migrations } from './seed'
import type { AppState, CollectionKey } from './types'

const KEY = 'growth-os:v1'
/** Offline copy of the endpoint's data. Never the source of truth: read-only when the endpoint is unreachable. */
const CACHE_KEY = 'growth-os:v1:endpoint-cache'
/** Storage keys used by older builds, listed in the private workspace's migrations. */
const legacyKeys = () => (privateWorkspace() as { migrations?: Migrations } | undefined)?.migrations?.storageKeys ?? []

/**
 * Where data lives:
 * - local: this browser's localStorage (no endpoint configured, e.g. the public demo or dev).
 * - endpoint: the Growth OS API is the source of truth; edits are sent as REST calls.
 * - empty: the endpoint has no workspace yet (run the migration). Shows the sample, saves nothing.
 * - offline: the endpoint is unreachable; the last cached copy is shown read-only.
 */
export type SyncMode = 'local' | 'endpoint' | 'empty' | 'offline'

export type InitialData =
  | { mode: 'local'; private: PrivateData }
  | { mode: 'endpoint'; state: EndpointState }
  | { mode: 'offline'; error: string }

export interface SyncStatus {
  mode: SyncMode
  pending: boolean
  error: string | null
  lastSync: string | null
}

function loadLocal(): AppState | null {
  try {
    const raw = localStorage.getItem(KEY) ?? legacyKeys().map((k) => localStorage.getItem(k)).find(Boolean)
    if (raw) {
      const parsed = JSON.parse(raw) as AppState
      if (parsed.version === 1) return migrateState(parsed as AppState & Record<string, unknown>, createSeed())
    }
  } catch {
    /* fall through to a fresh seed */
  }
  return null
}

const hasStorage = () => typeof localStorage !== 'undefined'

let state: AppState | null = null
/** Last state confirmed by the endpoint. Edits are diffed against it. */
let synced: AppState | null = null
let status: SyncStatus = { mode: 'local', pending: false, error: null, lastSync: null }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const ensure = (): AppState => (state ??= (hasStorage() && loadLocal()) || createSeed())

const setStatus = (s: Partial<SyncStatus>) => {
  status = { ...status, ...s }
  emit()
}

function applyEndpoint(s: EndpointState) {
  const base = s.profile ? createBlankSeed(s.profile, state?.settings.campaignStart) : createSeed()
  const mapped = fromEndpoint(s, { ...base, tiktokImport: state?.tiktokImport ?? null })
  setPrivateData(mapped.private)
  state = synced = mapped.state
  if (hasStorage())
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(s))
    } catch {
      /* cache is best-effort */
    }
  return mapped.state
}

/** The state the server rendered with. Pure (no localStorage), so server and client hydrate identically. */
export function initialView(initial: InitialData): AppState {
  if (initial.mode === 'local') {
    setPrivateData(initial.private)
    return createSeed()
  }
  if (initial.mode === 'endpoint' && initial.state.initialized) {
    const base = createBlankSeed(initial.state.profile!)
    const mapped = fromEndpoint(initial.state, base)
    setPrivateData(mapped.private)
    return mapped.state
  }
  setPrivateData({})
  return createSeed()
}

/** Called once in the browser by the workspace provider. */
export function initStore(initial: InitialData) {
  if (initial.mode === 'local') {
    setPrivateData(initial.private)
    state = (hasStorage() && loadLocal()) || createSeed()
    status = { mode: 'local', pending: false, error: null, lastSync: null }
  } else if (initial.mode === 'endpoint' && initial.state.initialized) {
    applyEndpoint(initial.state)
    status = { mode: 'endpoint', pending: false, error: null, lastSync: new Date().toISOString() }
  } else if (initial.mode === 'endpoint') {
    setPrivateData({})
    state = createSeed()
    status = { mode: 'empty', pending: false, error: 'The endpoint has no workspace yet. Run the one-time migration.', lastSync: null }
  } else {
    const cached = hasStorage() ? localStorage.getItem(CACHE_KEY) : null
    if (cached) applyEndpoint(JSON.parse(cached) as EndpointState)
    else state = createSeed()
    status = { mode: 'offline', pending: false, error: `Endpoint unreachable (${initial.error}). Showing the last cached copy, read-only.`, lastSync: null }
  }
  emit()
}

let timer: ReturnType<typeof setTimeout> | undefined
let flushing = false
const SYNC_DELAY_MS = 600

async function flush() {
  if (status.mode !== 'endpoint' || flushing || !synced || !state) return
  flushing = true
  const target = state
  const ops = diff(synced, target)
  try {
    for (const op of ops) await send(op)
    synced = target
    setStatus({ pending: state !== synced, error: null, lastSync: new Date().toISOString() })
  } catch (e) {
    setStatus({ error: e instanceof Error ? e.message : String(e) })
    // Roll back to what the endpoint actually holds.
    await refresh(true)
  } finally {
    flushing = false
    if (state !== synced) schedule()
  }
}

const schedule = () => {
  clearTimeout(timer)
  timer = setTimeout(flush, SYNC_DELAY_MS)
}

/** Pull the endpoint's latest data (e.g. handoffs written by agents). Skipped while local edits are pending. */
export async function refresh(force = false) {
  if (status.mode !== 'endpoint' && status.mode !== 'offline') return
  if (!force && state !== synced) return
  const before = state
  try {
    const s = await fetchState()
    if (!force && state !== before) return
    if (!s.initialized) return
    applyEndpoint(s)
    setStatus({ mode: 'endpoint', pending: false, lastSync: new Date().toISOString(), ...(force ? {} : { error: null }) })
  } catch (e) {
    if (!force) setStatus({ error: e instanceof Error ? e.message : String(e) })
  }
}

function commit(next: AppState) {
  if (status.mode === 'offline' || status.mode === 'empty') {
    setStatus({ error: status.mode === 'offline' ? 'Offline: changes are not saved until the endpoint is reachable.' : 'The endpoint has no workspace yet. Run the one-time migration first.' })
    return
  }
  state = next
  if (status.mode === 'endpoint') {
    setStatus({ pending: true })
    schedule()
    return
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* storage full or unavailable: keep in memory */
  }
  emit()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** The state the server rendered with, provided by the workspace provider for hydration. */
export const ServerStateContext = createContext<AppState | null>(null)

export function useAppState() {
  const server = useContext(ServerStateContext)
  return useSyncExternalStore(subscribe, ensure, () => server ?? ensure())
}

const getStatus = () => status
const serverStatus: SyncStatus = { mode: 'local', pending: false, error: null, lastSync: null }
export const useSyncStatus = () => useSyncExternalStore(subscribe, getStatus, () => serverStatus)

export const getState = () => ensure()

export const update = (fn: (s: AppState) => AppState) => commit(fn(ensure()))

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

/**
 * Example records that "Clear demo data" would remove. Handoffs are a log and are never deleted, and a demo
 * record that a real handoff points at is kept: the agents are using it.
 */
export function demoRecords(s: AppState): { collection: CollectionKey; id: string }[] {
  const used = new Set(s.handoffs.filter((h) => !h.demo).map((h) => h.itemId))
  return COLLECTIONS.filter((k) => k !== 'handoffs').flatMap((k) =>
    (s[k] as { id: string; demo?: boolean }[]).filter((i) => i.demo && !used.has(i.id)).map((i) => ({ collection: k, id: i.id })),
  )
}

export const hasDemoData = (s: AppState) => demoRecords(s).length > 0

export function clearDemoData() {
  update((s) => {
    const drop = new Set(demoRecords(s).map((r) => `${r.collection}/${r.id}`))
    const next = { ...s }
    for (const k of COLLECTIONS) (next as Record<string, unknown>)[k] = (s[k] as { id: string }[]).filter((i) => !drop.has(`${k}/${i.id}`))
    return next
  })
}

export const exportJSON = () => JSON.stringify(ensure(), null, 2)

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
