export const UNKNOWN = 'UNKNOWN' as const
export type Unknown = typeof UNKNOWN

/** A number we actually observed, or UNKNOWN. Never 0 as a stand-in for "missing". */
export type Metric = number | Unknown

export const toMetric = (v: unknown): Metric => (typeof v === 'number' && Number.isFinite(v) ? v : UNKNOWN)

/** Blank text is unknown, not empty. */
export const toKnownText = (v: unknown): string => (typeof v === 'string' && v.trim() ? v : UNKNOWN)
