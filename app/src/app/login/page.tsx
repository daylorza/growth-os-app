import type { Metadata } from 'next'
import { Orbit } from 'lucide-react'
import { Card } from '../../components/ui'
import { safeNext } from '../../lib/session.server'
import { LoginForm } from './LoginForm'

export const metadata: Metadata = { title: 'Sign in · Growth OS' }

const ERRORS: Record<string, string> = {
  denied: 'That username and password did not match.',
  not_creator: 'This login is for the API only. The dashboard needs the creator login.',
  unreachable: 'The Growth OS API is unreachable right now. Try again in a moment.',
}

/** In-app sign-in, replacing the browser's Basic-auth prompt. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent"><Orbit size={23} /></span>
          <div>
            <h1 className="font-semibold tracking-wide">Sign in</h1>
            <div className="text-[11px] tracking-widest text-muted uppercase">Growth Operating System</div>
          </div>
        </div>
        <LoginForm next={safeNext(next)} message={error ? (ERRORS[error] ?? 'Sign-in failed.') : null} />
      </Card>
    </main>
  )
}
