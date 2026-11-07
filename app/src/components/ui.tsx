'use client'

import { X } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cx } from '../lib/cx'

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-2xl border border-ink-600 bg-ink-800 p-5 shadow-sm shadow-black/10', className)}>{children}</section>
}

export function CardTitle({ icon, children, right }: { icon?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      {icon && <span className="text-accent">{icon}</span>}
      <h2 className="text-base font-medium">{children}</h2>
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  )
}

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'
const tones: Record<Tone, string> = {
  neutral: 'bg-ink-700 text-fg',
  accent: 'bg-accent/15 text-accent',
  ok: 'bg-ok/10 text-ok',
  warn: 'bg-warn/10 text-warn',
  danger: 'bg-danger/10 text-danger',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs whitespace-nowrap', tones[tone])}>
      {children}
    </span>
  )
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-ink-950 hover:bg-accent/90 font-medium',
  secondary: 'bg-ink-700 text-fg hover:bg-ink-600 border border-ink-600',
  ghost: 'text-muted hover:text-fg hover:bg-ink-700',
  danger: 'text-danger hover:bg-danger/10 border border-danger/30',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
        variants[variant],
        className,
      )}
    />
  )
}

const inputBase =
  'w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-accent/60'

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: ReactNode
  children: (id: string) => ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  )
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputBase, p.className)} />
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea rows={3} {...p} className={cx(inputBase, 'resize-y', p.className)} />
)

export function Select<T extends string>({
  options,
  value,
  onChange,
  ...p
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  options: Record<T, string> | readonly T[]
  value: T
  onChange: (v: T) => void
}) {
  const entries = Array.isArray(options)
    ? (options as readonly T[]).map((o) => [o, o] as const)
    : (Object.entries(options) as [T, string][])
  return (
    <select {...p} value={value} onChange={(e) => onChange(e.target.value as T)} className={cx(inputBase, p.className)}>
      {entries.map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  )
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const titleId = useId()
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    dialog?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
      } else if (e.key === 'Tab' && dialog) {
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
          .filter((el) => !el.closest('[hidden], [inert], [aria-hidden="true"]') && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden')
        const first = controls[0]
        const last = controls.at(-1)
        if (!first || !last) {
          e.preventDefault()
          dialog.focus()
        } else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog || !dialog.contains(document.activeElement))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div ref={dialogRef} role="dialog" aria-modal aria-labelledby={titleId} tabIndex={-1} className="relative flex h-full w-full max-w-2xl flex-col border-l border-ink-600 bg-ink-900">
        <header className="flex items-center gap-3 border-b border-ink-600 px-4 py-4 sm:px-6">
          <div id={titleId} className="min-w-0 flex-1 text-base font-medium">{title}</div>
          <Button variant="ghost" size="sm" className="min-h-11 min-w-11" onClick={onClose} aria-label="Close">
            <X size={16} />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
        {footer && <footer className="flex flex-wrap items-center gap-2 border-t border-ink-600 px-4 py-4 sm:px-6">{footer}</footer>}
      </div>
    </div>
  )
}

export function PageHeader({ eyebrow, title, right, children }: { eyebrow: string; title: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs tracking-widest text-muted uppercase">{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {children && <p className="mt-2 max-w-2xl text-sm text-muted">{children}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {right}
      </div>
    </header>
  )
}

export function Stat({ label, value, icon, note }: { label: string; value: ReactNode; icon?: ReactNode; note?: ReactNode }) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between text-sm text-muted">
        <span>{label}</span>
        {icon && <span className="text-accent">{icon}</span>}
      </div>
      <div className="mt-4 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      {note && <div className="mt-2 text-sm leading-relaxed text-muted">{note}</div>}
    </Card>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-600 px-5 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy', size = 'sm' }: { text: string; label?: string; size?: 'sm' | 'md' }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size={size}
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  )
}

export function Notice({ tone = 'warn', children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cx('rounded-lg px-3 py-2 text-xs', tones[tone])}>{children}</div>
}

export const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-xs text-muted">{children}</span>

export function Checkbox({ checked, onChange, label, strike = true }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; strike?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 cursor-pointer appearance-none rounded-full border border-faint bg-ink-600 checked:border-accent checked:bg-accent"
      />
      <span className={cx(checked && strike && 'text-muted line-through')}>{label}</span>
    </label>
  )
}

export function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-ink-600" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${pct}%` }} />
    </div>
  )
}
