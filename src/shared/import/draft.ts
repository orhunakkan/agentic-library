import type { BookBlock, DraftBook, DraftChapter, SourceProblem } from './blocks.ts'
import { chapterWords } from './detect.ts'
import { readEpub } from './epub.ts'
import {
  MAX_BOOK_IMAGE_BYTES,
  MAX_BOOK_IMAGES,
  MAX_CHAPTER_BLOCKS,
  MAX_CHAPTER_REQUEST_BYTES,
  MAX_CHAPTERS,
  MAX_SOURCE_BYTES,
  MAX_USER_IMAGE_BYTES,
  MB,
} from './limits.ts'
import { readMarkdownFile, readMarkdownZip } from './markdown.ts'
import { paginate } from './paginate.ts'
import { NO_PICTURES, type RenderContext, renderBlocks } from './render.ts'

export class ImportError extends Error {
  name = 'ImportError'
}

export type SourceKind = 'epub' | 'pdf' | 'markdown' | 'zip'

export function sourceKind(fileName: string): SourceKind | null {
  if (/\.epub$/i.test(fileName)) return 'epub'
  if (/\.pdf$/i.test(fileName)) return 'pdf'
  if (/\.(md|markdown)$/i.test(fileName)) return 'markdown'
  if (/\.zip$/i.test(fileName)) return 'zip'
  return null
}

export async function openBook(fileName: string, bytes: Uint8Array): Promise<DraftBook> {
  const kind = sourceKind(fileName)
  if (!kind) throw new ImportError('Choose an .epub, .pdf, .md or .zip file.')
  if (kind === 'pdf') throw new Error('openBook does not read PDFs; the browser opens them with pdf-open.ts')
  if (bytes.length > MAX_SOURCE_BYTES) throw new ImportError(`The file is larger than ${MAX_SOURCE_BYTES / MB} MB.`)
  let book: DraftBook
  try {
    book = await readSource(kind, bytes, fileName)
  } catch (error) {
    throw new ImportError(`This file couldn’t be read: ${(error as Error).message}.`)
  }
  return finishDraft(book)
}

export function finishDraft(book: DraftBook): DraftBook {
  const { title, author, language, details, cover, pictures } = book
  const chapters = splitOversized(book.chapters)
  if (!chapters.length) throw new ImportError('No text was found in this file.')
  return { title, author, language, details, cover, chapters, pictures }
}

async function readSource(kind: Exclude<SourceKind, 'pdf'>, bytes: Uint8Array, fileName: string): Promise<DraftBook> {
  switch (kind) {
    case 'epub':
      return readEpub(bytes, { fileName })
    case 'zip':
      return readMarkdownZip(bytes, fileName)
    case 'markdown':
      return readMarkdownFile(new TextDecoder('utf-8').decode(bytes), fileName)
  }
}

export const renameChapter = (chapters: readonly DraftChapter[], index: number, title: string): DraftChapter[] =>
  chapters.map((c, i) => (i === index ? { ...c, title } : c))

export const dropChapter = (chapters: readonly DraftChapter[], index: number): DraftChapter[] =>
  chapters.filter((_, i) => i !== index)

export function mergeIntoPrevious(chapters: readonly DraftChapter[], index: number): DraftChapter[] {
  const previous = chapters[index - 1]
  const chapter = chapters[index]
  if (!previous || !chapter) return [...chapters]
  const heading: BookBlock[] = chapter.title.trim()
    ? [{ type: 'heading', level: 3, runs: [{ text: chapter.title.trim() }] }]
    : []
  const merged = { title: previous.title, blocks: [...previous.blocks, ...heading, ...chapter.blocks] }
  return [...chapters.slice(0, index - 1), merged, ...chapters.slice(index + 1)]
}

export function chapterRequest(chapter: DraftChapter): string {
  return JSON.stringify({ title: chapter.title.trim(), blocks: chapter.blocks })
}

const bytesOf = (text: string) => new TextEncoder().encode(text).length

export function splitOversized(
  chapters: readonly DraftChapter[],
  { maxBytes = MAX_CHAPTER_REQUEST_BYTES, maxBlocks = MAX_CHAPTER_BLOCKS } = {},
): DraftChapter[] {
  const budget = maxBytes - bytesOf(chapterRequest({ title: '', blocks: [] })) - 1024
  return chapters.flatMap((chapter) => {
    if (chapter.blocks.length <= maxBlocks && bytesOf(chapterRequest(chapter)) <= maxBytes) return [chapter]
    const parts: BookBlock[][] = [[]]
    let size = 0
    for (const block of chapter.blocks) {
      const blockBytes = bytesOf(JSON.stringify(block)) + 1
      const current = parts.at(-1) as BookBlock[]
      if (current.length && (size + blockBytes > budget || current.length >= maxBlocks)) {
        parts.push([block])
        size = blockBytes
      } else {
        current.push(block)
        size += blockBytes
      }
    }
    return parts.map((blocks, i) => ({ title: i === 0 ? chapter.title : `${chapter.title} (part ${i + 1})`, blocks }))
  })
}

export function oversizedChapters(chapters: readonly DraftChapter[], maxBytes = MAX_CHAPTER_REQUEST_BYTES): number[] {
  return chapters.flatMap((c, i) => (bytesOf(chapterRequest(c)) > maxBytes ? [i] : []))
}

export type ChapterProblem = 'none' | 'too-many' | 'oversized'

export function saveableChapters(
  chapters: readonly DraftChapter[],
): { ok: true; chapters: DraftChapter[] } | { ok: false; problem: ChapterProblem } {
  const saved = splitOversized(
    chapters.map((c, i) => ({ ...c, title: c.title.trim() || `Chapter ${i + 1}` })).filter((c) => c.blocks.length),
  )
  if (!saved.length) return { ok: false, problem: 'none' }
  if (saved.length > MAX_CHAPTERS) return { ok: false, problem: 'too-many' }
  if (oversizedChapters(saved).length) return { ok: false, problem: 'oversized' }
  return { ok: true, chapters: saved }
}

export function previewPages(chapter: DraftChapter, context: RenderContext = NO_PICTURES): string[] {
  return paginate(renderBlocks(chapter.blocks, context))
}

export type PictureState =
  | { ok: true; bytes: number; width: number; height: number }
  | { ok: false; problem: SourceProblem | 'small' }

export type LeftOutReason = SourceProblem | 'book' | 'room'
export const LEFT_OUT_REASONS: readonly LeftOutReason[] = ['remote', 'large', 'unreadable', 'missing', 'book', 'room']

export interface PictureRoom {
  count: number
  bytes: number
  userBytesLeft: number
}

export const BOOK_ROOM = (userBytesLeft = MAX_USER_IMAGE_BYTES): PictureRoom => ({
  count: MAX_BOOK_IMAGES,
  bytes: MAX_BOOK_IMAGE_BYTES,
  userBytesLeft,
})

export interface PicturePlan {
  chapters: DraftChapter[]
  uploads: number[]
  bytes: number
  leftOut: Record<LeftOutReason, number>
  numbers: Map<number, number>
}

export function planPictures(
  chapters: readonly DraftChapter[],
  state: (draftNumber: number) => PictureState | undefined,
  room: PictureRoom,
): PicturePlan {
  const numbers = new Map<number, number>()
  const seen = new Set<number>()
  const uploads: number[] = []
  const leftOut = Object.fromEntries(LEFT_OUT_REASONS.map((r) => [r, 0])) as Record<LeftOutReason, number>
  let bytes = 0
  const decide = (n: number) => {
    if (seen.has(n)) return
    seen.add(n)
    const picture = state(n) ?? { ok: false, problem: 'unreadable' }
    if (!picture.ok) {
      if (picture.problem !== 'small') leftOut[picture.problem]++
      return
    }
    if (uploads.length + 1 > room.count || bytes + picture.bytes > room.bytes) leftOut.book++
    else if (bytes + picture.bytes > room.userBytesLeft) leftOut.room++
    else {
      uploads.push(n)
      bytes += picture.bytes
      numbers.set(n, uploads.length)
    }
  }
  const numbered = chapters.map((chapter) => ({
    ...chapter,
    blocks: chapter.blocks.flatMap((block): BookBlock[] => {
      if (block.type !== 'image' || block.image === 0) return [block]
      decide(block.image)
      const n = numbers.get(block.image)
      if (n) return [{ ...block, image: n }]
      return block.caption ? [{ ...block, image: 0 }] : []
    }),
  }))
  return { chapters: numbered, uploads, bytes, leftOut, numbers }
}

export { chapterWords }
