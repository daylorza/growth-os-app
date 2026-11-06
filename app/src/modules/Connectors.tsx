'use client'

import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Card, CardTitle, Input, Notice } from '../components/ui'
import { CONNECTORS, type ConnectorDef } from '../lib/connectors'
import { shortDate } from '../lib/dates'
import { connectorServer, connectUrl, disconnect, fetchConnections, syncTikTok, type ServerConnection } from '../lib/oauth'
import { update, useAppState } from '../lib/store'
import { mergeSnapshots } from '../lib/tiktok'
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

  return (
    <Card className="mt-4">
      <CardTitle right={<Badge tone={server ? 'ok' : 'neutral'}>{server ? 'Connector server set' : 'Export files only'}</Badge>}>Accounts and connectors</CardTitle>
      <p className="-mt-2 mb-4 text-sm text-muted">
        Read-only. Import analytics exports today, or connect accounts through a connector server. Nothing here can post, reply or message.
      </p>
      {serverError && <Notice tone="danger">{serverError}</Notice>}
      <div className="flex flex-col gap-3">
        {CONNECTORS.map((c) => (
          <ConnectorRow key={c.id} c={c} handle={s.profile.handles[c.id] ?? ''} connection={connections.find((x) => x.id === c.id)} onConnections={setConnections} />
        ))}
      </div>
      {!server && (
        <p className="mt-4 text-xs text-faint">
          “Connect” buttons need a connector server that runs OAuth and keeps tokens off this browser. Set <code>NEXT_PUBLIC_CONNECTOR_SERVER</code> to enable them.
        </p>
      )}
    </Card>
  )
}

function ConnectorRow({ c, handle, connection, onConnections }: { c: ConnectorDef; handle: string; connection?: ServerConnection; onConnections: (x: ServerConnection[]) => void }) {
  const tk = useTikTok()
  const url = connectUrl(c.id)
  const age = c.id === 'tiktok' ? dataAge(tk) : null
  const status = connection ? (
    <Badge tone="ok">Connected · {connection.handle}</Badge>
  ) : age ? (
    <Badge tone={age.stale ? 'warn' : 'ok'}>Exports · {shortDate(age.newest)}</Badge>
  ) : (
    <Badge>Not connected</Badge>
  )
  const setHandle = (v: string) => update((st) => ({ ...st, profile: { ...st.profile, handles: { ...st.profile.handles, [c.id]: v } } }))

  return (
    <details className="rounded-xl border border-ink-600 bg-ink-900" open={c.id === 'tiktok'}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3">
        <span className="w-24 text-sm font-medium">{c.name}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">{handle || 'No handle set'}</span>
        {status}
      </summary>
      <div className="grid gap-4 border-t border-ink-600 p-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            Handle
            <Input placeholder={c.handlePlaceholder} value={handle} onChange={(e) => setHandle(e.target.value)} />
          </label>
          <div>
            <div className="mb-1 text-xs text-muted">Connect with {c.oauth.api}</div>
            {connection ? (
              <div className="flex flex-wrap gap-2">
                {c.id === 'tiktok' && <SyncTikTokButton />}
                <Button size="sm" variant="ghost" onClick={async () => { await disconnect(c.id); onConnections(await fetchConnections()) }}>Disconnect</Button>
              </div>
            ) : (
              <Button size="sm" disabled={!url} onClick={() => url && window.location.assign(url)} title={url ? undefined : 'Needs NEXT_PUBLIC_CONNECTOR_SERVER'}>
                Connect {c.name}
              </Button>
            )}
            <p className="mt-1 text-xs text-faint">
              Read-only{c.oauth.scopes.length ? `: ${c.oauth.scopes.join(', ')}` : ''}. {c.oauth.note}
            </p>
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs text-muted">Import export files</div>
          <ol className="mb-3 list-decimal pl-4 text-xs text-muted">
            {c.exportFiles.steps.map((x) => <li key={x}>{x}</li>)}
          </ol>
          {c.id === 'tiktok' ? <TikTokImport /> : <Badge>Parser not built yet</Badge>}
        </div>
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
        <Button
          size="sm"
          variant="ghost"
          disabled={!s.tiktokImport}
          onClick={() => confirm('Remove TikTok data imported in this browser? Vault files are not affected.') && update((st) => ({ ...st, tiktokImport: null }))}
        >
          Clear browser import
        </Button>
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
