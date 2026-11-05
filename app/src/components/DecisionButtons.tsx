'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { refresh } from '../lib/store'
import { Button } from './ui'

type Decision = 'approve' | 'request_changes' | 'kill'

/** The creator's call on one content item. The endpoint writes the creator handoff and wakes the agents. */
export function DecisionButtons({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const decide = async (decision: Decision) => {
    let note = ''
    if (decision === 'request_changes') {
      const n = prompt('What should change?')
      if (n === null) return
      note = n
    }
    if (decision === 'kill' && !confirm(`Kill ${id}? Its drafts are marked killed.`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-items/${encodeURIComponent(id)}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-growth-client': 'dashboard', 'x-growth-source': 'dashboard' },
        body: JSON.stringify({ decision, ...(note ? { note } : {}) }),
      })
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`)
      router.refresh()
      await refresh(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="primary" disabled={busy} onClick={() => decide('approve')}>Approve</Button>
      <Button size="sm" disabled={busy} onClick={() => decide('request_changes')}>Request changes</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide('kill')}>Kill</Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </div>
  )
}
