'use client'

import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Card, CardTitle, ConfirmButton, Input, Notice } from '../components/ui'
import { CONNECTORS, type ConnectorDef } from '../lib/connectors'
import { shortDate } from '../lib/dates'
import { connectorServer, connectUrl, disconnect, fetchConnections, syncTikTok, type ServerConnection } from '../lib/oauth'
import { update, useAppState } from '../lib/store'
import { mergeSnapshots } from '../lib/tiktok'
import type { HandleKey } from '../lib/types'
import { dataAge, importTikTokFiles, useTikTok, vaultSnapshot, type ImportResult } from '../lib/tiktokData'
import { FreshnessNotice } from './TikTokStudio'

export default function ConnectorsCard() {
  const s = useAppState()
  const server = connectorServer()
  const [connections, setConnections] = useState<ServerConnection[]>([])
  const [serverError, setServerError] = useState<string | null>(null)

  useEffect(() => {
    if (!server) return
    fetchConnections().then(setConnections, (e: Error) => setServerError(e.message))
  }, [server])

  const inUse = (c: ConnectorDef) => !!c.reader || !!s.profile.handles[c.id]?.trim() || connections.some((x) => x.id === c.id)
  const active = CONNECTORS.filter(inUse)
  const unused = CONNECTORS.filter((c) => !inUse(c))
  const read = active.filter((c) => c.reader).length

  return (
    <Card className="mt-4">
      <CardTitle right={<Badge tone={read ? 'ok' : 'neutral'}>{read} read by your agents</Badge>}>Accounts and connectors</CardTitle>
      <p className="-mt-2 mb-4 text-sm text-muted">
        Read-only. Your agents read these accounts with their own access and record what they see here. Nothing on this page can post, reply or message.
      </p>
      {serverError && <Notice tone="danger">{serverError}</Notice>}
      <div className="flex flex-col gap-3">
        {active.map((c) => (
          <ConnectorRow key={c.id} c={c} server={!!server} connection={connections.find((x) => x.id === c.id)} onConnections={setConnections} />
        ))}
      </div>
      {unused.length > 0 && <p className="mt-4 text-xs text-faint">Not set up: {unused.map((c) => c.name).join(', ')}. Add a handle in Setup to track one.</p>}
    </Card>
  )
}

/** Latest date anything arrived for a platform: a snapshot or an engagement item. */
function latestData(s: ReturnType<typeof useAppState>, id: ConnectorDef['id']) {
  const dates = [...s.snapshots.filter((x) => x.platform === id && !x.demo).map((x) => x.date), ...s.engagements.filter((e) => e.platform === id && !e.demo).map((e) => e.createdAt.slice(0, 10))]
  return dates.sort().at(-1) ?? null
}

function ConnectorRow({ c, server, connection, onConnections }: { c: ConnectorDef; server: boolean; connection?: ServerConnection; onConnections: (x: ServerConnection[]) => void }) {
  const s = useAppState()
  const tk = useTikTok()
  const url = connectUrl(c.id)
  const age = c.id === 'tiktok' ? dataAge(tk) : null
  const latest = [latestData(s, c.id), age?.newest ?? null].filter((d): d is string => !!d).sort().at(-1) ?? null
  const agent = c.reader ? s.profile.agents[c.reader.role].name : null
  const handles = [s.profile.handles[c.id], ...(c.extraHandles ?? []).map((h) => s.profile.handles[h.key])].filter((h): h is string => !!h?.trim())
  const apiLast = c.api ? s.snapshots.filter((x) => x.platform === c.id && x.id.startsWith(c.api!.idPrefix)).map((x) => x.date).sort().at(-1) : undefined
  const status = connection ? (
    <Badge tone="ok">Connected · {connection.handle}</Badge>
  ) : apiLast && c.api ? (
    <Badge tone="ok">{c.api.label} · {shortDate(apiLast)}</Badge>
  ) : agent ? (
    <Badge tone="ok">Read by {agent}</Badge>
  ) : age ? (
    <Badge tone={age.stale ? 'warn' : 'ok'}>Exports · {shortDate(age.newest)}</Badge>
  ) : (
    <Badge>Handle only</Badge>
  )
  const setHandle = (key: HandleKey, v: string) => update((st) => ({ ...st, profile: { ...st.profile, handles: { ...st.profile.handles, [key]: v } } }))

  return (
    <details className="rounded-xl border border-ink-600 bg-ink-900">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3">
        <span className="w-24 text-sm font-medium">{c.name}</span>
        <span className="min-w-32 flex-1 truncate text-xs text-muted">{handles.join(' · ') || 'No handle set'}</span>
        <span className="text-xs text-faint">{latest ? `Latest data ${shortDate(latest)}` : 'No data yet'}</span>
        {status}
      </summary>
      <div className="grid gap-4 border-t border-ink-600 p-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            {c.extraHandles ? 'Personal handle' : 'Handle'}
            <Input placeholder={c.handlePlaceholder} value={s.profile.handles[c.id] ?? ''} onChange={(e) => setHandle(c.id, e.target.value)} />
          </label>
          {c.extraHandles?.map((h) => (
            <label key={h.key} className="flex flex-col gap-1.5 text-xs text-muted">
              {h.label}
              <Input placeholder={c.handlePlaceholder} value={s.profile.handles[h.key] ?? ''} onChange={(e) => setHandle(h.key, e.target.value)} />
            </label>
          ))}
          {c.api && (
            <p className="text-xs text-muted">
              Counts: the {c.api.label} connector on the host, {c.api.schedule}{apiLast ? ` (last pull ${shortDate(apiLast)})` : ' (not authorized yet)'}. Read-only.
            </p>
          )}
          {agent && c.reader && (
            <p className="text-xs text-muted">
              {c.api ? 'Everything else: ' : ''}{agent} reads it through {c.reader.via}. Sign-ins stay with {agent}; never enter a password here.
            </p>
          )}
          {(server || connection) && (
            <div>
              <div className="mb-1 text-xs text-muted">Connect with {c.oauth.api}</div>
              {connection ? (
                <div className="flex flex-wrap gap-2">
                  {c.id === 'tiktok' && <SyncTikTokButton />}
                  <Button size="sm" variant="ghost" onClick={async () => { await disconnect(c.id); onConnections(await fetchConnections()) }}>Disconnect</Button>
                </div>
              ) : (
                <Button size="sm" disabled={!url} onClick={() => url && window.location.assign(url)}>
                  Connect {c.name}
                </Button>
              )}
              <p className="mt-1 text-xs text-faint">
                Read-only{c.oauth.scopes.length ? `: ${c.oauth.scopes.join(', ')}` : ''}. {c.oauth.note}
              </p>
            </div>
          )}
        </div>
        {c.exportFiles.status === 'available' && (
          <div>
            <div className="mb-1 text-xs text-muted">Import export files</div>
            <ol className="mb-3 list-decimal pl-4 text-xs text-muted">
              {c.exportFiles.steps.map((x) => <li key={x}>{x}</li>)}
            </ol>
            {c.id === 'tiktok' && <TikTokImport />}
          </div>
        )}
      </div>
    </details>
  )
}

function SyncTikTokButton() {
  const s = useAppState()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <>
      <Button
        size="sm"
        onClick={async () => {
          try {
            const snap = await syncTikTok()
            update((st) => ({ ...st, tiktokImport: st.tiktokImport ? mergeSnapshots(st.tiktokImport, snap) : snap }))
            setMsg('Synced.')
          } catch (e) {
            setMsg((e as Error).message)
          }
        }}
      >
        Sync now
      </Button>
      {msg && <span className="text-xs text-muted" role="status">{msg} {s.tiktokImport && `(${s.tiktokImport.exports.length} sources in this browser)`}</span>}
    </>
  )
}

function TikTokImport() {
  const s = useAppState()
  const tk = useTikTok()
  const ref = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const base = vaultSnapshot(s.profile.sample)
  return (
    <div className="flex flex-col gap-2">
      <FreshnessNotice tk={tk} />
      <p className="text-xs text-faint">
        {base.exports.length ? `${s.profile.sample ? 'Sample data' : 'Private vault'}: ${base.exports.length} files. ` : ''}
        Imported in this browser: {s.tiktokImport ? `${s.tiktokImport.exports.length} files` : 'none'}.
      </p>
      {s.profile.sample && <Notice tone="neutral">This is the fictional sample workspace. Choose “Make it yours” first so real data never mixes with sample data.</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={s.profile.sample} onClick={() => ref.current?.click()}>Import TikTok export files</Button>
        <input
          ref={ref}
          type="file"
          accept=".csv,text/csv"
          multiple
          className="hidden"
          aria-label="TikTok export CSV files"
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (!files.length) return
            const { snapshot, result } = await importTikTokFiles(files, s.tiktokImport, base)
            if (result.added.length) update((st) => ({ ...st, tiktokImport: snapshot }))
            setResult(result)
          }}
        />
        <ConfirmButton
          size="sm"
          variant="ghost"
          disabled={!s.tiktokImport}
          message="Remove TikTok data imported in this browser? Vault files are not affected."
          onConfirm={() => update((st) => ({ ...st, tiktokImport: null }))}
        >
          Clear browser import
        </ConfirmButton>
      </div>
      {result && (
        <p className="text-xs text-muted" role="status">
          Imported {result.added.length} file{result.added.length === 1 ? '' : 's'} · {result.duplicates.length} already loaded
          {result.rejected.length > 0 && ` · not a TikTok export: ${result.rejected.join(', ')}`}
        </p>
      )}
    </div>
  )
}
