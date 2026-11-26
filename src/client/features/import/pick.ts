import { MAX_BOOKS } from '~/shared/import/limits'
import { BOOK_QUOTA_TEXT } from './import-problems'

export type PickRoute = { kind: 'book'; file: File } | { kind: 'audio'; files: File[] } | { kind: 'mixed' } | null

const AUDIO = /\.(m4b|mp3|m4a|m4p|aax|aa|ogg|oga|opus|flac|wav)$/i

export const isAudioName = (name: string) => AUDIO.test(name)

export function routePick(files: readonly File[]): PickRoute {
  if (!files.length) return null
  const audio = files.filter((f) => isAudioName(f.name))
  if (!audio.length) return { kind: 'book', file: files[0] as File }
  if (audio.length !== files.length) return { kind: 'mixed' }
  if (audio.length > 1 && audio.some((f) => !/\.mp3$/i.test(f.name))) return { kind: 'mixed' }
  return { kind: 'audio', files: [...audio] }
}

export const pickerAccept = (audiobooks: boolean) =>
  audiobooks ? '.epub,.pdf,.md,.markdown,.zip,.m4b,.mp3' : '.epub,.pdf,.md,.markdown,.zip'

export function pickRefusal(kind: 'book' | 'audio' | 'mixed', bookCount: number): string | null {
  if (kind === 'mixed') return null
  return bookCount >= MAX_BOOKS ? BOOK_QUOTA_TEXT : null
}
