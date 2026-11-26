import { formatBytes } from '~/shared/lib/format-bytes'
import type { AccountStorage } from '~/shared/limits/limits'

export const STORAGE_INTRO = 'What your account holds, and the most this server lets each account keep.'

export const OVER_LIMIT_TEXT = 'Over the limit, delete some to add more.'

export interface StorageLine {
  key: 'books' | 'articles' | 'audio' | 'pictures'
  label: string
  text: string
  /** Where the meter stands: the usage, but never past full. */
  value: number
  max: number
  over: boolean
}

function line(key: StorageLine['key'], label: string, used: number, max: number, text: string): StorageLine {
  return { key, label, text, value: Math.min(used, max), max, over: used > max }
}

/** A line that counts things, such as "3 of 25 books". */
const countLine = (key: StorageLine['key'], label: string, count: number, max: number, one: string, many: string) =>
  line(key, label, count, max, `${count} of ${max} ${max === 1 ? one : many}`)

/** A line that measures bytes, such as "412 MB of 1 GB of audiobooks". */
const sizeLine = (key: StorageLine['key'], label: string, bytes: number, max: number, what: string) =>
  line(key, label, bytes, max, `${formatBytes(bytes)} of ${formatBytes(max)} of ${what}`)

/** The Storage section's lines, without the audiobooks' when this server has them off. */
export function storageLines(storage: AccountStorage): StorageLine[] {
  const { limits } = storage
  const lines = [
    countLine('books', 'Books', storage.bookCount, limits.books, 'book', 'books'),
    countLine('articles', 'Saved articles', storage.articleCount, limits.articles, 'saved article', 'saved articles'),
    sizeLine('audio', 'Audiobooks', storage.audioBytes, limits.userAudioBytes, 'audiobooks'),
    sizeLine('pictures', 'Pictures', storage.pictureBytes, limits.userPictureBytes, 'pictures'),
  ]
  return storage.audiobooks ? lines : lines.filter((storageLine) => storageLine.key !== 'audio')
}
