import { AUTHOR_MAX, checkDetails, cleanText, LANGUAGE_TAG, TITLE_MAX } from '../import/blocks.ts'
import type { BookDetails } from '../import/details.ts'
import { isObject, only } from '../lib/json-shape.ts'
import { type AudioChapter, CHAPTER_TITLE_MAX, chaptersTile, cleanTitle } from './chapters.ts'
import {
  type AudioFileType,
  MAX_AUDIO_CHAPTERS,
  MAX_AUDIO_FILES,
  MAX_AUDIOBOOK_BYTES,
  MAX_CHAPTER_MS,
  MAX_FILE_MS,
  NARRATOR_MAX,
} from './limits.ts'

export interface AudiobookStart {
  title: string
  author: string
  narrator: string | null
  language: string
  details: BookDetails
  type: AudioFileType
  files: number[]
  chapters: AudioChapter[]
  cover: boolean
}

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

function line(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = cleanText(value).replace(/\s+/g, ' ').trim()
  return text && text.length <= max ? text : null
}

function parseChapter(value: unknown, fileCount: number): AudioChapter | null {
  if (!isObject(value) || !only(value, ['title', 'fileN', 'startMs', 'durationMs'])) return null
  if (typeof value.title !== 'string' || value.title.length > CHAPTER_TITLE_MAX * 2) return null
  const title = cleanTitle(value.title)
  const { fileN, startMs, durationMs } = value
  if (!title || !isInt(fileN, 1, fileCount) || !isInt(startMs, 0, MAX_FILE_MS)) return null
  if (!isInt(durationMs, 1, MAX_CHAPTER_MS)) return null
  return { title, fileN, startMs, durationMs }
}

export function parseAudiobookStart(value: unknown, now = new Date()): AudiobookStart | null {
  if (!isObject(value)) return null
  if (!only(value, ['title', 'author', 'narrator', 'language', 'details', 'files', 'chapters', 'cover'])) return null
  const title = line(value.title, TITLE_MAX)
  const author = line(value.author, AUTHOR_MAX)
  const language = typeof value.language === 'string' ? value.language.trim() : ''
  if (!title || !author || !LANGUAGE_TAG.test(language) || typeof value.cover !== 'boolean') return null
  let narrator: string | null = null
  if (value.narrator !== undefined && value.narrator !== null) {
    if (typeof value.narrator !== 'string') return null
    if (value.narrator.trim()) {
      narrator = line(value.narrator, NARRATOR_MAX)
      if (!narrator) return null
    }
  }

  const raw = value.details
  if (!isObject(raw) || !only(raw, ['description', 'isbn', 'publisher', 'publishedYear'])) return null
  let details: BookDetails
  try {
    details = checkDetails(raw, now)
  } catch {
    return null
  }

  const list = value.files
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_AUDIO_FILES) return null
  const files: number[] = []
  let type: AudioFileType | null = null
  for (const file of list) {
    if (!isObject(file) || !only(file, ['type', 'bytes'])) return null
    if ((file.type !== 'mp4' && file.type !== 'mp3') || (type && file.type !== type)) return null
    if (!isInt(file.bytes, 1, MAX_AUDIOBOOK_BYTES)) return null
    type = file.type
    files.push(file.bytes)
  }
  if (!type || (type === 'mp4' && files.length !== 1)) return null
  if (files.reduce((n, b) => n + b, 0) > MAX_AUDIOBOOK_BYTES) return null

  if (!Array.isArray(value.chapters) || value.chapters.length < 1 || value.chapters.length > MAX_AUDIO_CHAPTERS)
    return null
  const chapters: AudioChapter[] = []
  for (const item of value.chapters) {
    const chapter = parseChapter(item, files.length)
    if (!chapter) return null
    chapters.push(chapter)
  }
  if (!chaptersTile(chapters, files.length)) return null
  return { title, author, narrator, language, details, type, files, chapters, cover: value.cover }
}
