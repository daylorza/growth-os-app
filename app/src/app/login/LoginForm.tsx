'use client'

import { Button, Field, Input } from '../../components/ui'

/** A plain form post to /auth/login, so it also works before JavaScript loads. */
export function LoginForm({ next, message }: { next: string; message: string | null }) {
  return (
    <form method="post" action="/auth/login" className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Username">{(id) => <Input id={id} name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus />}</Field>
      <Field label="Password">{(id) => <Input id={id} name="password" type="password" autoComplete="current-password" required />}</Field>
      {message && <p role="alert" className="text-sm text-danger">{message}</p>}
      <Button type="submit" variant="primary" className="w-full">Sign in</Button>
    </form>
  )
}
