'use client'

import { refresh, useSyncStatus } from '../lib/store'

/** Where this dashboard's data lives right now, and whether the last save worked. */
export function SyncBanner() {
  const s = useSyncStatus()
  if (s.mode === 'local' && !s.error) return null
  const tone = s.error ? 'border-warn/40 bg-warn/5' : 'border-ink-600 bg-ink-900'
  return (
    <div role="status" className={`mb-6 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-2.5 text-xs ${tone}`}>
      <span className="font-mono tracking-wide text-muted uppercase">{s.mode === 'endpoint' ? 'Endpoint' : s.mode}</span>
      <span className="min-w-0 flex-1 text-muted">
        {s.error ??
          (s.pending ? 'Saving…' : `Saved to the Growth OS endpoint${s.lastSync ? ` · synced ${new Date(s.lastSync).toLocaleTimeString()}` : ''}`)}
      </span>
      {(s.mode === 'endpoint' || s.mode === 'offline') && (
        <button className="text-accent hover:underline" onClick={() => refresh(true)}>
          Refresh
        </button>
      )}
    </div>
  )
}
