import { GB } from '../audiobooks/limits.ts'
import { KB, MB } from '../import/limits.ts'

const oneDecimal = (value: number) => Math.round(value * 10) / 10

/** A size as people read it: whole KB, or MB and GB with one decimal, such as 512 KB, 100 MB or 1.5 GB. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB'
  const kilobytes = Math.max(1, Math.round(bytes / KB))
  if (kilobytes < 1024) return `${kilobytes} KB`
  const megabytes = oneDecimal(bytes / MB)
  if (megabytes < 1024) return `${megabytes} MB`
  return `${oneDecimal(bytes / GB)} GB`
}
