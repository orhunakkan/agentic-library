export type Day = string

const DAY_MS = 86_400_000

const DAY_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/

export function isDay(value: unknown): value is Day {
  if (typeof value !== 'string') return false
  const match = DAY_FORMAT.exec(value)
  if (!match) return false
  const [, y, m, d] = match.map(Number) as [number, number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

const formats = new Map<string, Intl.DateTimeFormat>()

export function dayIn(date: Date, zone: string): Day {
  let format = formats.get(zone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    formats.set(zone, format)
  }
  const parts = Object.fromEntries(format.formatToParts(date).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

const utcOf = (day: Day) => Date.parse(`${day}T00:00:00Z`)
const dayOf = (ms: number): Day => new Date(ms).toISOString().slice(0, 10)

export const addDays = (day: Day, n: number): Day => dayOf(utcOf(day) + n * DAY_MS)

export const daysBetween = (a: Day, b: Day): number => Math.round((utcOf(b) - utcOf(a)) / DAY_MS)

export const weekdayOf = (day: Day): number => new Date(utcOf(day)).getUTCDay()

const ZONE_CHARS = /^[A-Za-z0-9_+\-/]{1,64}$/

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !ZONE_CHARS.test(value) || value.includes('..')) return false
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value })
    return true
  } catch {
    return false
  }
}
