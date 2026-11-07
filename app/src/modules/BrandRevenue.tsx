'use client'

import Link from 'next/link'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, CardTitle, Drawer, Empty, Field, Input, Mono, Notice, PageHeader, Select, Stat, Textarea } from '../components/ui'
import { today } from '../lib/dates'
import { LEAD_STATUS, LEAD_TYPE, PLATFORM, UNKNOWN } from '../lib/labels'
import { nextId } from '../lib/rules'
import { patch, remove, upsert, useAppState } from '../lib/store'
import type { Lead, LeadStatus } from '../lib/types'

const COLUMNS: LeadStatus[] = ['new', 'day_reviewing', 'discovery_call', 'won', 'parked', 'lost']

export default function BrandRevenue() {
  const s = useAppState()
  const [openId, setOpenId] = useState<string | null>(null)
  const open = s.leads.find((l) => l.id === openId)
  const qualified = s.leads.filter((l) => l.type === 'client_inquiry' && l.status !== 'lost').length
  const calls = s.leads.filter((l) => l.status === 'discovery_call' || l.status === 'won').length
  const evidenced = s.leads.filter((l) => l.attributedRevenue && l.revenueEvidence.trim())
  const revenue = evidenced.reduce((n, l) => n + (l.attributedRevenue ?? 0), 0)

  const create = () => {
    const id = nextId('L', s.leads)
    upsert('leads', { id, handle: '', platform: 'tiktok', type: 'client_inquiry', status: 'new', summary: '', nextStep: '', source: 'Manual', revenueEvidence: '', createdAt: today() })
    setOpenId(id)
  }

  return (
    <>
      <PageHeader eyebrow="Brand & Revenue" title={`${s.profile.company || 'Brand'} leads and partnerships`} right={<Button variant="primary" onClick={create}><Plus size={16} /> New lead</Button>}>
        Relationships first. {s.profile.creatorName} handles every reply to a lead. No prices, contracts or delivery promises without {s.profile.creatorName}.
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Qualified inquiries" value={qualified} />
        <Stat label="Discovery calls" value={calls} />
        <Stat label="Verified traffic" value={<span className="text-2xl text-muted">Unavailable</span>} note="No analytics connected" />
        <Stat label="Attributed revenue" value={evidenced.length ? `$${revenue.toLocaleString()}` : <span className="text-2xl text-muted">None yet</span>} note="Counted only with evidence" />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {COLUMNS.map((col) => {
          const items = s.leads.filter((l) => l.status === col)
          return (
            <div key={col} className="rounded-2xl border border-ink-600 bg-ink-900 p-3">
              <div className="mb-3 flex items-center justify-between text-xs text-muted">
                <span>{LEAD_STATUS[col]}</span>
                <span className="tabular-nums">{items.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {items.map((l) => (
                  <button key={l.id} onClick={() => setOpenId(l.id)} className="rounded-xl border border-ink-600 bg-ink-800 p-3 text-left text-sm hover:border-accent/40">
                    <div className="flex items-center gap-2"><Mono>{l.id}</Mono><Badge tone="accent">{LEAD_TYPE[l.type]}</Badge></div>
                    <div className="mt-1.5 truncate">{l.handle ? `@${l.handle.replace(/^@/, '')}` : 'Unnamed'}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted">{l.summary || '—'}</div>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {s.leads.length === 0 && (
        <div className="mt-4"><Empty title="No leads yet">Flag client inquiries and collaborations from the Engagement Hub, or add one here.</Empty></div>
      )}

      <Card className="mt-4">
        <CardTitle right={<Link href="/settings" className="text-xs text-accent">Edit in brief</Link>}>Approved offers and resources</CardTitle>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          {([['offers', 'Offers'], ['landingPage', 'Landing page'], ['contactRoute', 'Contact route']] as const).map(([k, label]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className={s.brief[k].value === UNKNOWN ? 'text-warn' : ''}>{s.brief[k].value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-faint">Disclose sponsorships and affiliations as platform rules require. Never imply a partnership that does not exist.</p>
      </Card>

      {open && <LeadDrawer lead={open} onClose={() => setOpenId(null)} />}
    </>
  )
}

function LeadDrawer({ lead: l, onClose }: { lead: Lead; onClose: () => void }) {
  const set = (c: Partial<Lead>) => patch('leads', l.id, c)
  return (
    <Drawer
      open
      onClose={onClose}
      title={<span className="flex items-center gap-2"><Mono>{l.id}</Mono> Lead</span>}
      footer={
        <Button variant="danger" className="ml-auto" onClick={() => { if (confirm(`Delete ${l.id}?`)) { remove('leads', l.id); onClose() } }}>
          <Trash2 size={14} /> Delete
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Public handle">{(id) => <Input id={id} value={l.handle} onChange={(e) => set({ handle: e.target.value })} />}</Field>
        <Field label="Platform">{(id) => <Select id={id} options={{ ...PLATFORM, other: 'Other' }} value={l.platform} onChange={(platform) => set({ platform })} />}</Field>
        <Field label="Type">{(id) => <Select id={id} options={LEAD_TYPE} value={l.type} onChange={(type) => set({ type })} />}</Field>
        <Field label="Stage">{(id) => <Select id={id} options={LEAD_STATUS} value={l.status} onChange={(status) => set({ status })} />}</Field>
        <Field label="What they need" className="sm:col-span-2">{(id) => <Textarea id={id} value={l.summary} onChange={(e) => set({ summary: e.target.value })} />}</Field>
        <Field label="Next step (owner)" className="sm:col-span-2">{(id) => <Input id={id} value={l.nextStep} onChange={(e) => set({ nextStep: e.target.value })} />}</Field>
        <Field label="Source">{(id) => <Input id={id} value={l.source} onChange={(e) => set({ source: e.target.value })} />}</Field>
        <Field label="Attributed revenue ($)">
          {(id) => <Input id={id} type="number" min={0} value={l.attributedRevenue ?? ''} onChange={(e) => set({ attributedRevenue: e.target.value === '' ? undefined : Number(e.target.value) })} />}
        </Field>
        <Field label="Revenue evidence" hint="Required for revenue to count. e.g. invoice ID, signed SOW." className="sm:col-span-2">
          {(id) => <Input id={id} value={l.revenueEvidence} onChange={(e) => set({ revenueEvidence: e.target.value })} />}
        </Field>
        {l.attributedRevenue != null && !l.revenueEvidence.trim() && (
          <div className="sm:col-span-2"><Notice>Revenue without evidence is not counted.</Notice></div>
        )}
        <div className="sm:col-span-2">
          <Notice tone="neutral">Keep minimal information. No private client details, contracts or contact data beyond a public handle.</Notice>
        </div>
      </div>
    </Drawer>
  )
}
