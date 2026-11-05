/**
 * Client side of OAuth connectors. The browser never sees access tokens: a separate
 * connector server (set VITE_CONNECTOR_SERVER) runs the OAuth flow, stores tokens, and
 * returns read-only, normalised data. Without a server, "Connect" stays disabled.
 *
 * Server contract (all read-only, session cookie, CORS for this origin):
 *   GET  /connect/:id?return_to=<url>   start OAuth, redirect back to return_to
 *   GET  /connections                   -> ServerConnection[]
 *   GET  /sync/tiktok                   -> TikTokSnapshot (same shape as tiktok.ts)
 *   POST /disconnect/:id                revoke and delete stored tokens
 * The server must never post, reply, message or follow on the account's behalf.
 */
import type { TikTokSnapshot } from './tiktok'
import type { ConnectorId } from './types'

export interface ServerConnection {
  id: ConnectorId
  handle: string
  connectedAt: string
  lastSyncAt?: string
}

export const connectorServer = (): string | null => {
  const url = (import.meta.env.VITE_CONNECTOR_SERVER as string | undefined)?.trim()
  return url ? url.replace(/\/+$/, '') : null
}

export function connectUrl(id: ConnectorId, server = connectorServer()): string | null {
  if (!server) return null
  const back = `${window.location.origin}${window.location.pathname}#/settings`
  return `${server}/connect/${id}?return_to=${encodeURIComponent(back)}`
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const server = connectorServer()
  if (!server) throw new Error('No connector server configured.')
  const res = await fetch(`${server}${path}`, { credentials: 'include', ...init })
  if (!res.ok) throw new Error(`Connector server returned ${res.status} for ${path}.`)
  return res.json() as Promise<T>
}

export const fetchConnections = () => call<ServerConnection[]>('/connections')
export const syncTikTok = () => call<TikTokSnapshot>('/sync/tiktok')
export const disconnect = (id: ConnectorId) => call<unknown>(`/disconnect/${id}`, { method: 'POST' })
