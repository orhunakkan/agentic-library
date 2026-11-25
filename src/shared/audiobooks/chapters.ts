import { cleanText } from '../import/blocks.ts'
import { MAX_AUDIO_CHAPTERS, MAX_CHAPTER_MS, PART_MS } from './limits.ts'

export const CHAPTER_TITLE_MAX = 300

export interface AudioChapter {
  title: string
  fileN: number
  startMs: number
  durationMs: number
}

export interface FileReading {
  durationMs: number
  chapters: { title: string; startMs: number }[]
  title: string
}

export type ChaptersFrom = 'file' | 'files' | 'parts'

export type ChapterProblem = 'chapters' | 'long'

export type BuiltChapters =
  | { ok: true; chapters: AudioChapter[]; from: ChaptersFrom }
  | { ok: false; problem: ChapterProblem }

export function cleanTitle(title: string): string {
  return cleanText(title).replace(/\s+/g, ' ').trim().slice(0, CHAPTER_TITLE_MAX).trim()
}

const titleOr = (title: string, position: number) => cleanTitle(title) || `Chapter ${position}`

function parts(fileN: number, durationMs: number): Omit<AudioChapter, 'title'>[] {
  const count = Math.max(1, Math.ceil(durationMs / PART_MS))
  return Array.from({ length: count }, (_, i) => ({
    fileN,
    startMs: i * PART_MS,
    durationMs: Math.min(PART_MS, durationMs - i * PART_MS),
  }))
}

function windows(fileN: number, reading: FileReading): AudioChapter[] {
  const marks = reading.chapters
    .map((c) => ({ title: c.title, startMs: Math.max(0, Math.round(c.startMs)) }))
    .filter((c) => c.startMs < reading.durationMs)
    .sort((a, b) => a.startMs - b.startMs)
    .filter((c, i, all) => i === 0 || c.startMs !== all[i - 1]?.startMs)
  const first = marks[0]
  if (first) first.startMs = 0
  return marks.map((c, i) => ({
    title: c.title,
    fileN,
    startMs: c.startMs,
    durationMs: (marks[i + 1]?.startMs ?? reading.durationMs) - c.startMs,
  }))
}

export function buildChapters(files: readonly FileReading[]): BuiltChapters {
  let from: ChaptersFrom
  let found: AudioChapter[]
  const only = files.length === 1 ? files[0] : undefined
  if (only?.chapters.length) {
    from = 'file'
    found = windows(1, only)
  } else if (only) {
    from = 'parts'
    found = parts(1, only.durationMs).map((p, i) => ({ ...p, title: `Part ${i + 1}` }))
  } else {
    from = 'files'
    found = files.map((f, i) => ({ title: f.title, fileN: i + 1, startMs: 0, durationMs: f.durationMs }))
  }
  if (found.length > MAX_AUDIO_CHAPTERS) return { ok: false, problem: 'chapters' }
  if (found.some((c) => c.durationMs > MAX_CHAPTER_MS)) return { ok: false, problem: 'long' }
  return { ok: true, from, chapters: found.map((c, i) => ({ ...c, title: titleOr(c.title, i + 1) })) }
}

export function chaptersTile(chapters: readonly AudioChapter[], fileCount: number): boolean {
  let file = 0
  let end = 0
  for (const c of chapters) {
    if (c.fileN === file + 1) {
      file = c.fileN
      if (c.startMs !== 0) return false
    } else if (c.fileN !== file || c.startMs !== end) return false
    end = c.startMs + c.durationMs
  }
  return file === fileCount
}

export function fitToFiles(chapters: readonly AudioChapter[], durations: readonly number[]): AudioChapter[] | null {
  const fitted = chapters.map((c, i) => {
    const last = chapters[i + 1]?.fileN !== c.fileN
    return last ? { ...c, durationMs: (durations[c.fileN - 1] ?? 0) - c.startMs } : { ...c }
  })
  const ok = fitted.every(
    (c) =>
      c.durationMs >= 1 && c.durationMs <= MAX_CHAPTER_MS && c.startMs + c.durationMs <= (durations[c.fileN - 1] ?? 0),
  )
  return ok ? fitted : null
}

export const totalMs = (chapters: readonly { durationMs: number }[]) => chapters.reduce((n, c) => n + c.durationMs, 0)

export function formatLength(ms: number): string {
  if (ms < 60_000) return `${Math.min(59, Math.max(1, Math.round(ms / 1000)))} s`
  const minutes = Math.round(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${minutes} min`
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}
