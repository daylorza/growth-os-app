'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { signInAgainIf401 } from '../lib/remote'
import type { DecisionState as State } from '../lib/rules'
import { refresh } from '../lib/store'
import { Button, ConfirmButton, Field, Textarea } from './ui'

type Decision = 'approve' | 'request_changes' | 'kill'

/**
 * The creator's call on one content item. The endpoint writes the creator handoff and wakes the agents.
 * A decision already made is greyed out, so a second click cannot repeat it.
 */
export function DecisionButtons({ id, state: initial }: { id: string; state: State }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<State>(initial)
  const [editingNote, setEditingNote] = useState(false)
  const [note, setNote] = useState('')

  const decide = async (decision: Decision) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-items/${encodeURIComponent(id)}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-growth-client': 'dashboard', 'x-growth-source': 'dashboard' },
        body: JSON.stringify({ decision, ...(decision === 'request_changes' && note ? { note } : {}) }),
      })
      signInAgainIf401(res)
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${res.status})`)
      setState(decision === 'approve' ? 'approved' : decision === 'kill' ? 'killed' : 'changes_requested')
      setEditingNote(false)
      setNote('')
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
      <Button size="sm" variant="primary" disabled={busy || state === 'approved' || state === 'killed'} onClick={() => decide('approve')}>
        {state === 'approved' ? 'Approved' : 'Approve'}
      </Button>
      <Button size="sm" disabled={busy || state === 'killed'} onClick={() => setEditingNote(true)}>
        {state === 'changes_requested' ? 'Changes requested' : 'Request changes'}
      </Button>
      <ConfirmButton size="sm" variant="ghost" disabled={busy || state === 'killed'} message={`Kill ${id}? Its drafts are marked killed.`} onConfirm={() => decide('kill')}>
        {state === 'killed' ? 'Killed' : 'Kill'}
      </ConfirmButton>
      {editingNote && <div className="w-full space-y-2"><Field label="What should change?">{(fieldId) => <Textarea id={fieldId} value={note} onChange={(e) => setNote(e.target.value)} />}</Field><div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => decide('request_changes')}>Submit changes</Button><Button size="sm" disabled={busy} onClick={() => { setEditingNote(false); setNote('') }}>Cancel</Button></div></div>}
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </div>
  )
}
