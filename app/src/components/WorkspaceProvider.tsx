'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { initialView, initStore, refresh, ServerStateContext, type InitialData } from '../lib/store'

const POLL_MS = 30_000

/**
 * Hydrates the client store from data the server component loaded. Server and first client render use the
 * same pure view; after hydration the client store takes over (local storage, or the endpoint plus polling).
 */
export function WorkspaceProvider({ initial, children }: { initial: InitialData; children: ReactNode }) {
  const [view] = useState(() => {
    const v = initialView(initial)
    if (typeof window !== 'undefined') initStore(initial)
    return v
  })

  useEffect(() => {
    if (initial.mode === 'local') return
    // Agents write handoffs and snapshots on their own schedule: pick them up without a reload.
    const t = setInterval(() => refresh(), POLL_MS)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [initial.mode])

  return <ServerStateContext.Provider value={view}>{children}</ServerStateContext.Provider>
}
