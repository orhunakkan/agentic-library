import { MAX_BOOK_IMAGES } from '../../shared/import/limits.ts'

export function parseImageNumber(value: string): number | null {
  if (!/^[1-9]\d{0,2}$/.test(value)) return null
  const n = Number(value)
  return n <= MAX_BOOK_IMAGES ? n : null
}
