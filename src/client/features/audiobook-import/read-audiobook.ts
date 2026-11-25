import { parseBlob } from 'music-metadata'
import {
  type AudioChapter,
  buildChapters,
  type ChaptersFrom,
  cleanTitle,
  type FileReading,
  totalMs,
} from '~/shared/audiobooks/chapters'
import { mp4Audio, type ReadRange } from '~/shared/audiobooks/drm'
import {
  type AudioFileType,
  MAX_AUDIO_CHAPTERS,
  MAX_AUDIO_FILES,
  MAX_AUDIOBOOK_BYTES,
  MAX_USER_AUDIO_BYTES,
  MIN_FILE_MS,
  PARALLEL_FILES,
  SNIFF_BYTES,
} from '~/shared/audiobooks/limits'
import { playOrder, titleFromFileName } from '~/shared/audiobooks/order'
import { sniffAudio } from '~/shared/audiobooks/sniff'
import { LANGUAGE_TAG, type SourceCover } from '~/shared/import/blocks'
import { type BookDetails, cleanDescription } from '~/shared/import/details'
import { sniffImage } from '~/shared/import/image'
import { type AudiobookProblem, problem } from './audiobook-problems'

export class AudiobookReadError extends Error {
  name = 'AudiobookReadError'
  readonly problem: AudiobookProblem
  constructor(problem: AudiobookProblem) {
    super(problem.code)
    this.problem = problem
  }
}

export interface AudiobookDraft {
  type: AudioFileType
  files: File[]
  title: string
  author: string
  narrator: string
  language: string
  details: BookDetails
  cover: SourceCover | null
  chapters: AudioChapter[]
  from: ChaptersFrom
  totalMs: number
  bytes: number
}

type Parse = typeof parseBlob
type Tags = Awaited<ReturnType<Parse>>['common']

interface FileRead {
  file: File
  type: AudioFileType
  reading: FileReading
  tags: Tags
}

const fail = (p: AudiobookProblem): never => {
  throw new AudiobookReadError(p)
}

const blobRange =
  (file: Blob): ReadRange =>
  async (start, end) =>
    new Uint8Array(await file.slice(start, end).arrayBuffer())

const tag = (value: string | string[] | null | undefined) => cleanTitle((Array.isArray(value) ? value[0] : value) ?? '')

async function kindOf(file: File): Promise<{ type: AudioFileType; soundless: boolean }> {
  const sniffed = sniffAudio(await blobRange(file)(0, SNIFF_BYTES))
  if (sniffed === 'aax') return fail(problem('aax'))
  if (sniffed === 'm4a-drm') return fail(problem('drm'))
  if (typeof sniffed === 'object') return fail({ code: 'type', type: sniffed.other })
  if (sniffed === 'mp3') return { type: 'mp3', soundless: false }
  const sound = await mp4Audio(blobRange(file), file.size)
  if (sound === 'drm') return fail(problem('drm'))
  if (sound === 'other') return fail({ code: 'unreadable', reason: 'its sound isn’t AAC' })
  return { type: 'mp4', soundless: sound === 'none' }
}

async function readFile(file: File, parse: Parse): Promise<FileRead> {
  const { type, soundless } = await kindOf(file)
  let metadata: Awaited<ReturnType<Parse>>
  try {
    metadata = await parse(file, {
      duration: true,
      includeChapters: true,
      maxChapterCount: MAX_AUDIO_CHAPTERS + 1,
      skipCovers: true,
    })
  } catch (error) {
    return fail({
      code: 'unreadable',
      reason: error instanceof Error && error.message ? error.message : 'unknown error',
    })
  }
  if (soundless) return fail({ code: 'unreadable', reason: 'it has no sound track' })
  const durationMs = Math.round((metadata.format.duration ?? 0) * 1000)
  if (!Number.isFinite(durationMs) || durationMs < MIN_FILE_MS)
    return fail({ code: 'unreadable', reason: 'its length couldn’t be read' })
  const chapters = (metadata.format.chapters ?? []).map((c) => ({
    title: c.title ?? '',
    startMs: (c.start / (c.timeScale ?? 1)) * 1000,
  }))
  const { common } = metadata
  return {
    file,
    type,
    reading: { durationMs, chapters, title: tag(common.title) || titleFromFileName(file.name) },
    tags: common,
  }
}

async function inParallel<T, R>(
  items: readonly T[],
  parallel: number,
  read: (item: T) => Promise<R>,
  onDone: () => void,
) {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await read(items[i] as T)
      onDone()
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, worker))
  return results
}

async function coverOf(file: File, parse: Parse): Promise<SourceCover | null> {
  try {
    const picture = (await parse(file, { skipPostHeaders: true })).common.picture?.[0]
    if (!picture) return null
    const bytes = new Uint8Array(picture.data)
    const info = sniffImage(bytes)
    return info ? { bytes, info, from: 'audio' } : null
  } catch {
    return null
  }
}

export interface ReadOptions {
  audioBytesUsed: number
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
  parse?: Parse
}

export async function readAudiobook(picked: readonly File[], options: ReadOptions): Promise<AudiobookDraft> {
  const parse = options.parse ?? parseBlob
  const bytes = picked.reduce((n, f) => n + f.size, 0)
  if (picked.length > MAX_AUDIO_FILES) fail(problem('files'))
  if (bytes > MAX_AUDIOBOOK_BYTES) fail(problem('large'))
  if (options.audioBytesUsed + bytes > MAX_USER_AUDIO_BYTES) fail(problem('room'))
  let done = 0
  options.onProgress?.(0, picked.length)
  const reads = await inParallel(
    picked,
    PARALLEL_FILES,
    async (file) => {
      if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      return readFile(file, parse)
    },
    () => options.onProgress?.(++done, picked.length),
  )
  const type = reads[0]?.type ?? 'mp3'
  if (reads.some((r) => r.type !== type) || (type === 'mp4' && reads.length !== 1)) fail(problem('mixed'))

  const ordered =
    type === 'mp3'
      ? playOrder(reads.map((r) => ({ name: r.file.name, disc: r.tags.disk.no, track: r.tags.track.no }))).map(
          (i) => reads[i] as FileRead,
        )
      : reads
  const built = buildChapters(ordered.map((r) => r.reading))
  if (!built.ok) return fail(problem(built.problem))

  const first = ordered[0] as FileRead
  const tags = first.tags
  const author = tag(tags.albumartist) || tag(tags.artist)
  const composer = tag(tags.composer)
  const language = tag(tags.language)
  const year = tags.year && tags.year >= 1 && tags.year <= new Date().getFullYear() + 1 ? tags.year : null
  const description =
    cleanDescription(tags.longDescription) ??
    cleanDescription(tags.description?.[0]) ??
    cleanDescription(tags.comment?.find((c) => c.text)?.text)
  return {
    type,
    files: ordered.map((r) => r.file),
    title: (tag(tags.album) || tag(tags.title) || titleFromFileName(first.file.name)).slice(0, 300),
    author: author.slice(0, 200),
    narrator: composer && composer !== author ? composer.slice(0, 200) : '',
    language: LANGUAGE_TAG.test(language) ? language : 'en',
    details: { description, isbn: null, publisher: null, publishedYear: year },
    cover: await coverOf(first.file, parse),
    chapters: built.chapters,
    from: built.from,
    totalMs: totalMs(built.chapters),
    bytes,
  }
}
