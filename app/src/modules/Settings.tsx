'use client'

import { Lock } from 'lucide-react'
import { useRef, useState } from 'react'
import { Badge, Button, Card, CardTitle, Checkbox, Field, Input, Notice, PageHeader, Textarea } from '../components/ui'
import { BRIEF_FIELDS, UNKNOWN, withProject } from '../lib/labels'
import { hasPrivateWorkspace } from '../lib/private'
import { exportJSON, importJSON, resetAll, update, useAppState, useSyncStatus } from '../lib/store'
import type { BriefKey, Profile, Settings as SettingsT } from '../lib/types'
import ConnectorsCard from './Connectors'
import { ProfileFields } from './Setup'

const PERMISSIONS = [
  'Publish posts',
  'Send public replies',
  'Send DMs or follow-ups',
  'Delete, hide or block',
  'Send reminders',
  'Partner outreach or commitments',
]

const looksLikeSecret = (v: string) =>
  /\b(password|passcode|pwd|2fa|otp|auth(entication)? code|verification code)\b/i.test(v) || /(^|\s)\d{6}(\s|$)/.test(v)

export default function Settings() {
  const s = useAppState()
  const sync = useSyncStatus()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const setBrief = (k: BriefKey, c: Partial<{ value: string; verified: boolean }>) =>
    update((st) => ({ ...st, brief: { ...st.brief, [k]: { ...st.brief[k], ...c } } }))
  const setSettings = (c: Partial<SettingsT>) => update((st) => ({ ...st, settings: { ...st.settings, ...c } }))
  const groups = [...new Set(BRIEF_FIELDS.map((f) => f.group))]
  const unknown = BRIEF_FIELDS.filter((f) => s.brief[f.key].value.trim() === UNKNOWN).length
  const live = sync.mode === 'endpoint' || sync.mode === 'offline'

  return (
    <>
      <PageHeader eyebrow="Settings & Integrations" title="Accounts, permissions and automation">
        The approved brief is the source of truth for both agents. Blank is never permission to invent: unknown stays UNKNOWN.
      </PageHeader>

      <Notice tone="danger">Never enter passwords, two-factor codes or authentication codes anywhere in this dashboard.</Notice>

      <Card className="mt-4">
        <CardTitle right={s.profile.sample && <Badge>Fictional sample</Badge>}>Workspace profile</CardTitle>
        <ProfileFields value={s.profile} withHandles={false} onChange={(profile: Profile) => update((st) => ({ ...st, profile }))} />
      </Card>

      <ConnectorsCard />

      <Card className="mt-4">
        <CardTitle right={<Badge tone={unknown ? 'warn' : 'ok'}>{unknown} UNKNOWN</Badge>}>Approved brief</CardTitle>
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <fieldset key={g} className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-3 text-xs tracking-widest text-accent uppercase">{withProject(g, s.profile.projectName)}</legend>
              {BRIEF_FIELDS.filter((f) => f.group === g).map((f) => {
                const v = s.brief[f.key]
                return (
                  <Field
                    key={f.key}
                    label={withProject(f.label, s.profile.projectName)}
                    className={f.multiline ? 'sm:col-span-2' : undefined}
                    hint={
                      <span className="flex flex-wrap items-center gap-3">
                        <Checkbox checked={v.verified} onChange={(verified) => setBrief(f.key, { verified })} label={`Verified by ${s.profile.creatorName}`} strike={false} />
                        {v.value !== UNKNOWN && (
                          <button className="text-faint hover:text-fg" onClick={() => setBrief(f.key, { value: UNKNOWN, verified: false })}>Mark UNKNOWN</button>
                        )}
                        {looksLikeSecret(v.value) && <span className="text-danger">This looks like a password or code. Remove it.</span>}
                      </span>
                    }
                  >
                    {(id) =>
                      f.multiline ? (
                        <Textarea id={id} rows={2} value={v.value} onChange={(e) => setBrief(f.key, { value: e.target.value })} className={v.value === UNKNOWN ? 'text-warn' : ''} />
                      ) : (
                        <Input id={id} value={v.value} onChange={(e) => setBrief(f.key, { value: e.target.value })} className={v.value === UNKNOWN ? 'text-warn' : ''} />
                      )
                    }
                  </Field>
                )
              })}
            </fieldset>
          ))}
        </div>
      </Card>

      <Card className="mt-4">
        <CardTitle>Campaign</CardTitle>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="30-day campaign start">{(id) => <Input id={id} type="date" value={s.settings.campaignStart} onChange={(e) => e.target.value && setSettings({ campaignStart: e.target.value })} />}</Field>
          <Field label="TikTok follower milestone">{(id) => <Input id={id} type="number" min={1} value={s.settings.tiktokGoal} onChange={(e) => setSettings({ tiktokGoal: Math.max(1, Number(e.target.value)) })} />}</Field>
          <Field label="Weekly TikTok target" hint="Test target. Lower it if capacity is tight.">
            {(id) => <Input id={id} type="number" min={0} value={s.settings.weeklyTikTokTarget} onChange={(e) => setSettings({ weeklyTikTokTarget: Math.max(0, Number(e.target.value)) })} />}
          </Field>
        </div>
      </Card>

      <div className="mt-4">
        <Card>
          <CardTitle icon={<Lock size={18} />}>Permissions: draft-only</CardTitle>
          <ul className="flex flex-col divide-y divide-ink-700">
            {PERMISSIONS.map((p) => (
              <li key={p} className="flex items-center justify-between py-2.5 text-sm">
                <span>{p}</span>
                <Badge>Off · locked</Badge>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-faint">Access alone is not permission. Turning any of these on needs {s.profile.creatorName}'s written policy and a supported integration.</p>
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle>Your data</CardTitle>
        <p className="mb-4 text-sm text-muted">
          {sync.mode === 'endpoint' ? 'Stored on the Growth OS endpoint. This browser keeps only an offline, read-only copy.' : 'Everything is stored in this browser only. Export a backup before clearing browser data.'} To make a backup this repo's default workspace, save it as <code>private/workspace.json</code> (gitignored).
          {hasPrivateWorkspace() && ' A private workspace file is loaded.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              const url = URL.createObjectURL(new Blob([exportJSON()], { type: 'application/json' }))
              const a = Object.assign(document.createElement('a'), { href: url, download: `growth-os-${new Date().toISOString().slice(0, 10)}.json` })
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            Export backup
          </Button>
          {!live && <Button onClick={() => fileRef.current?.click()}>Import backup</Button>}
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              if (!confirm('Importing replaces everything currently in the dashboard. Continue?')) return
              const err = importJSON(await file.text())
              setImportMsg(err ?? 'Backup imported.')
              e.target.value = ''
            }}
          />
          {!live && (
            <Button variant="danger" className="ml-auto" onClick={() => confirm('Erase everything and start over? This cannot be undone. Export a backup first.') && resetAll()}>
              Reset everything
            </Button>
          )}
        </div>
        {live && <p className="mt-3 text-xs text-faint">Import and reset are off on the live endpoint: they would overwrite the workspace your agents use. Export still works.</p>}
        {importMsg && <p className="mt-3 text-xs text-muted">{importMsg}</p>}
      </Card>
    </>
  )
}
