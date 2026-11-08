const pad = (n: number) => String(n).padStart(2, '0')

export const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const today = () => toISODate(new Date())

export const parseDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (s: string, n: number) => {
  const d = parseDate(s)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

export const daysBetween = (a: string, b: string) =>
  Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000)

export function campaignPosition(start: string, on: string = today()) {
  const diff = daysBetween(start, on)
  if (diff < 0) return { day: 0, week: 0, status: 'not_started' as const }
  if (diff >= 30) return { day: 30, week: 5, status: 'complete' as const }
  return { day: diff + 1, week: Math.floor(diff / 7) + 1, status: 'active' as const }
}

export function weekRange(on: string = today()) {
  const d = parseDate(on)
  const offset = (d.getDay() + 6) % 7
  const start = addDays(on, -offset)
  return { start, end: addDays(start, 6) }
}

export const weekdayName = (s: string) => parseDate(s).toLocaleDateString('en-US', { weekday: 'long' })

export const shortDate = (s: string) =>
  s ? parseDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'

export const nowStamp = () => new Date().toISOString()
