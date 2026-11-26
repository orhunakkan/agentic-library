export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.floor(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`
}

export function formatClock(ms: number, options: { remaining?: boolean } = {}): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const clock = hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${pad2(minutes)}:${pad2(seconds)}`
  return options.remaining ? `−${clock}` : clock
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** A moment as a 24-hour clock time such as 14:05, in `timeZone` or else the device's own. */
export const timeOfDay = (at: string | number, timeZone?: string) =>
  new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone })

export function relativeTime(then: number, now: number): string {
  const ago = now - then
  if (ago < MINUTE) return 'just now'
  if (ago < HOUR) return relative.format(-Math.floor(ago / MINUTE), 'minute')
  if (ago < DAY) return relative.format(-Math.floor(ago / HOUR), 'hour')
  if (ago < 30 * DAY) return relative.format(-Math.floor(ago / DAY), 'day')
  const date = new Date(then)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  const format = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  return `on ${format.format(date)}`
}
