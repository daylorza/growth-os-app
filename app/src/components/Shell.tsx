'use client'

import {
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  FlaskConical,
  LayoutGrid,
  LogOut,
  Menu,
  MessageCircle,
  Orbit,
  SlidersHorizontal,
  Target,
  TrendingUp,
  X,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NEEDS_ACTION } from '../lib/labels'
import { useProfile } from '../lib/profile'
import { useAppState, useSyncStatus } from '../lib/store'
import { useDropDemoTikTokBaseline } from '../lib/tiktokData'
import { cx } from '../lib/cx'
import { SetupDrawer } from '../modules/Setup'
import { SyncBanner } from './SyncBanner'

interface Route {
  slug: string
  href: string
  label: string
  description: string
  icon: LucideIcon
}

const ROUTES: Route[] = [
  { slug: 'overview', href: '/', label: 'Overview', description: 'Mission control and daily priorities', icon: LayoutGrid },
  { slug: 'audience', href: '/audience', label: 'Audience Growth', description: 'TikTok, X and Threads performance', icon: TrendingUp },
  { slug: 'studio', href: '/studio', label: 'Content Studio', description: '30-day calendar and script creation', icon: CalendarDays },
  { slug: 'engagement', href: '/engagement', label: 'Engagement Hub', description: 'Comments, keywords and conversations', icon: MessageCircle },
  { slug: 'agents', href: '/agents', label: 'Agent Control', description: 'Analyst and creative agents', icon: Bot },
  { slug: 'intelligence', href: '/intelligence', label: 'Content Intelligence', description: 'Experiments, trends and insights', icon: FlaskConical },
  { slug: 'revenue', href: '/revenue', label: 'Brand & Revenue', description: 'Leads and partnerships', icon: BriefcaseBusiness },
  { slug: 'goals', href: '/goals', label: 'Goals & Accountability', description: 'Milestones, routines and tasks', icon: Target },
  { slug: 'settings', href: '/settings', label: 'Settings & Integrations', description: 'Accounts, permissions and automation', icon: SlidersHorizontal },
]

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [navOpen, setNavOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const closeMenuButton = useRef<HTMLButtonElement>(null)
  useDropDemoTikTokBaseline()
  const profile = useProfile()
  const brand = profile.brandName.trim() || 'GROWTH OS'
  const route = ROUTES.find((r) => r.href === pathname) ?? ROUTES[0]
  const syncMode = useSyncStatus().mode
  const needsReply = useAppState().engagements.filter((e) => NEEDS_ACTION.includes(e.status) && !e.demo).length

  useEffect(() => {
    document.title = `${route.label} · ${brand} Growth OS`
  }, [route, brand])

  useEffect(() => {
    if (!navOpen) return
    closeMenuButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNavOpen(false)
        menuButton.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[19rem_1fr]">
      <a href="#main-content" className="sr-only z-50 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-950 focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <aside
        id="main-navigation"
        className={cx(
          'fixed inset-y-0 left-0 z-40 w-[min(19rem,100vw)] overflow-y-auto border-r border-ink-600/70 bg-ink-900 p-4 lg:sticky lg:top-0 lg:block lg:h-dvh lg:w-[19rem]',
          navOpen ? 'block' : 'hidden',
        )}
      >
        <div className="flex items-center gap-3 px-2 pt-2 pb-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent"><Orbit size={23} /></span>
          <div>
            <div className="font-semibold tracking-wide">{brand}</div>
            <div className="text-[11px] tracking-widest text-muted uppercase">Growth Operating System</div>
          </div>
          <button ref={closeMenuButton} className="ml-auto flex size-11 items-center justify-center text-muted lg:hidden" onClick={() => { setNavOpen(false); menuButton.current?.focus() }} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <div className="border-t border-ink-600 pt-5 pb-3 px-2 text-[11px] tracking-widest text-accent uppercase">
          Command center
        </div>
        <nav className="flex flex-col gap-1.5">
          {ROUTES.map((r, i) => {
            const active = r.slug === route.slug
            return (
              <Link
                key={r.slug}
                href={r.href}
                onClick={() => setNavOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
                  active ? 'bg-ink-700 ring-1 ring-inset ring-accent/40 shadow-[inset_3px_0_0_var(--color-accent)]' : 'hover:bg-ink-800',
                )}
              >
                <r.icon size={18} className={active ? 'text-accent' : 'text-muted group-hover:text-fg'} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">
                    <span className="font-mono text-xs text-faint">{String(i + 1).padStart(2, '0')} /</span> {r.label}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {r.slug === 'agents'
                      ? `${profile.agents.analyst.name} and ${profile.agents.creative.name} operations`
                      : r.slug === 'revenue' && profile.company.trim()
                        ? `${profile.company} leads and partnerships`
                        : r.description}
                  </span>
                </span>
                {r.slug === 'engagement' && needsReply > 0 && (
                  <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-xs font-medium text-ink-950" aria-label={`${needsReply} need a reply`} title={`${needsReply} need a reply`}>
                    {needsReply}
                  </span>
                )}
                {active && <ChevronRight size={16} className="text-accent" />}
              </Link>
            )
          })}
        </nav>
        <p className="mt-6 px-2 text-xs leading-relaxed text-faint">
          Draft-only. Nothing here posts, publishes, or sends messages. {profile.creatorName} approves and publishes every public action.
        </p>
        {syncMode !== 'local' && (
          <form method="post" action="/auth/logout" className="mt-4 px-2">
            <button type="submit" className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-xs text-muted hover:text-fg">
              <LogOut size={14} /> Sign out
            </button>
          </form>
        )}
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setNavOpen(false)} aria-hidden />}

      <div className="min-w-0">
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink-600 bg-ink-950/90 px-4 py-3 backdrop-blur lg:hidden">
          <button ref={menuButton} onClick={() => setNavOpen(true)} aria-label="Open menu" aria-expanded={navOpen} aria-controls="main-navigation" className="flex size-11 items-center justify-center text-muted">
            <Menu size={20} />
          </button>
          <span className="text-sm font-medium">{route.label}</span>
        </div>
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl outline-none px-4 py-6 sm:px-8 sm:py-10 xl:px-12">
          {profile.sample && (
            <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                You're exploring <strong>{profile.creatorName}</strong>, a fictional sample creator. All names, handles and numbers here are made up.
              </span>
              <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-accent/90" onClick={() => setSetupOpen(true)}>
                Make it yours
              </button>
            </div>
          )}
          <SyncBanner />
          {children}
        </main>
        <SetupDrawer open={setupOpen} onClose={() => setSetupOpen(false)} />
      </div>
    </div>
  )
}
