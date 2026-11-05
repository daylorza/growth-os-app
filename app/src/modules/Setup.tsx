import { useState } from 'react'
import { Button, Drawer, Field, Input, Notice } from '../components/ui'
import { CONNECTORS } from '../lib/connectors'
import { createBlankSeed, DEFAULT_AGENTS } from '../lib/seed'
import { resetAll } from '../lib/store'
import type { Profile } from '../lib/types'

export function ProfileFields({ value: p, onChange, withHandles = true }: { value: Profile; onChange: (p: Profile) => void; withHandles?: boolean }) {
  const set = (c: Partial<Profile>) => onChange({ ...p, ...c })
  const agent = (role: 'analyst' | 'creative', c: Partial<Profile['agents']['analyst']>) => set({ agents: { ...p.agents, [role]: { ...p.agents[role], ...c } } })
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Your name (shown as the approver)">{(id) => <Input id={id} value={p.creatorName} onChange={(e) => set({ creatorName: e.target.value })} />}</Field>
      <Field label="Workspace / brand name" hint="Shown in the sidebar.">{(id) => <Input id={id} value={p.brandName} onChange={(e) => set({ brandName: e.target.value })} />}</Field>
      <Field label="Company (optional)">{(id) => <Input id={id} value={p.company} onChange={(e) => set({ company: e.target.value })} />}</Field>
      <Field label="Anchor project (optional)" hint="The build you'll feature most, e.g. an app or demo.">{(id) => <Input id={id} value={p.projectName} onChange={(e) => set({ projectName: e.target.value })} />}</Field>
      <Field label="Analyst agent name">{(id) => <Input id={id} value={p.agents.analyst.name} onChange={(e) => agent('analyst', { name: e.target.value })} />}</Field>
      <Field label="Creative agent name">{(id) => <Input id={id} value={p.agents.creative.name} onChange={(e) => agent('creative', { name: e.target.value })} />}</Field>
      {withHandles &&
        CONNECTORS.map((c) => (
          <Field key={c.id} label={`${c.name} handle`}>
            {(id) => <Input id={id} placeholder={c.handlePlaceholder} value={p.handles[c.id] ?? ''} onChange={(e) => set({ handles: { ...p.handles, [c.id]: e.target.value } })} />}
          </Field>
        ))}
    </div>
  )
}

const empty: Profile = { creatorName: '', brandName: '', company: '', projectName: '', handles: {}, agents: DEFAULT_AGENTS, sample: false }

/** First run: replace the fictional sample with the visitor's own empty workspace. */
export function SetupDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [p, setP] = useState<Profile>(empty)
  const ready = p.creatorName.trim().length > 0
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Make it yours"
      footer={
        <>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => {
              resetAll(createBlankSeed({ ...p, brandName: p.brandName.trim() || p.creatorName.trim().toUpperCase() }))
              onClose()
              window.location.hash = '/settings'
            }}
          >
            Create my workspace
          </Button>
          <Button variant="ghost" onClick={onClose}>Keep exploring the sample</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          This replaces the fictional sample creator with an empty workspace. Nothing is invented: your brief starts as UNKNOWN until you fill it in. Everything stays in this browser.
        </p>
        <Notice tone="neutral">Handles only. Never enter passwords or two-factor codes.</Notice>
        <ProfileFields value={p} onChange={setP} />
      </div>
    </Drawer>
  )
}
