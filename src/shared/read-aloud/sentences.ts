import type { SpeechBlock, SpeechChapter, SpeechPageText } from './speech-text.ts'

export const MAX_UTTERANCE = 200

export const CODE_SAY = 'Code example.'

export interface Utterance {
  start: number
  end: number
  say: string
  kind: SpeechBlock['kind']
}

const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'st',
  'jr',
  'sr',
  'vs',
  'etc',
  'cf',
  'fig',
  'vol',
  'ch',
  'p',
  'pp',
])

const HAS_WORD = /[\p{L}\p{N}]/u

const segmenters = new Map<string, Intl.Segmenter>()

function segmenter(lang: string): Intl.Segmenter | null {
  if (typeof Intl.Segmenter !== 'function') return null
  let found = segmenters.get(lang)
  if (!found) {
    try {
      found = new Intl.Segmenter(lang, { granularity: 'sentence' })
    } catch {
      found = new Intl.Segmenter(undefined, { granularity: 'sentence' })
    }
    segmenters.set(lang, found)
  }
  return found
}

export function fallbackSentences(text: string): [number, number][] {
  const out: [number, number][] = []
  let start = 0
  for (const m of text.matchAll(/[.!?]+["'”’)\]]*\s+/g)) {
    const end = m.index + m[0].length
    out.push([start, end])
    start = end
  }
  if (start < text.length) out.push([start, text.length])
  return out
}

function rawSentences(text: string, lang: string, useIntl: boolean): [number, number][] {
  const seg = useIntl ? segmenter(lang) : null
  if (!seg) return fallbackSentences(text)
  return [...seg.segment(text)].map((s) => [s.index, s.index + s.segment.length])
}

function joinsNext(piece: string, next: string): boolean {
  const word = /([\p{L}]+)\.\s*$/u.exec(piece)?.[1]
  if (word && ABBREVIATIONS.has(word.toLowerCase())) return true
  const first = /\p{L}/u.exec(next)?.[0]
  const lead = next.slice(0, next.search(/\p{L}/u))
  return first !== undefined && /^[\s"'“”‘’([]*$/.test(lead) && first !== first.toUpperCase()
}

export function sentenceSpans(text: string, lang: string, options: { intl?: boolean } = {}): [number, number][] {
  const raw = rawSentences(text, lang, options.intl ?? true)
  const out: [number, number][] = []
  for (const span of raw) {
    const last = out.at(-1)
    if (last && joinsNext(text.slice(last[0], last[1]), text.slice(span[0], span[1]))) last[1] = span[1]
    else out.push([span[0], span[1]])
  }
  return out
}

export function cutLong(text: string, start: number, end: number, max = MAX_UTTERANCE): [number, number][] {
  const out: [number, number][] = []
  let pieceStart = start
  let last = end
  while (last > pieceStart && /\s/.test(text[last - 1] ?? '')) last--
  while (pieceStart < last) {
    while (pieceStart < last && /\s/.test(text[pieceStart] ?? '')) pieceStart++
    if (last - pieceStart <= max) {
      out.push([pieceStart, last])
      break
    }
    const window = text.slice(pieceStart, pieceStart + max)
    let cut = Math.max(...[',', ';', ':', '—'].map((mark) => window.lastIndexOf(mark))) + 1
    if (cut <= 0) cut = window.lastIndexOf(' ')
    if (cut <= 0) {
      cut = max
      if (/[\uD800-\uDBFF]/.test(window[max - 1] ?? '')) cut--
    }
    let e = pieceStart + cut
    while (e > pieceStart && /\s/.test(text[e - 1] ?? '')) e--
    out.push([pieceStart, e])
    pieceStart += cut
  }
  return out
}

/** Runs of whitespace become one space, and the ends are trimmed. */
export const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

export function utterances(page: SpeechPageText, lang: string, options: { intl?: boolean } = {}): Utterance[] {
  const out: Utterance[] = []
  for (const block of page.blocks) {
    const body = page.text.slice(block.start, block.end)
    if (block.kind === 'code') {
      if (!body.trim()) continue
      const lead = body.length - body.trimStart().length
      const trail = body.length - body.trimEnd().length
      out.push({ start: block.start + lead, end: block.end - trail, say: CODE_SAY, kind: 'code' })
      continue
    }
    for (const [a, b] of sentenceSpans(body, lang, options)) {
      for (const [s, e] of cutLong(body, a, b)) {
        const slice = body.slice(s, e)
        if (!HAS_WORD.test(slice)) continue
        out.push({ start: block.start + s, end: block.start + e, say: collapse(slice), kind: block.kind })
      }
    }
  }
  return out
}

export function chapterIntro(chapter: Pick<SpeechChapter, 'number' | 'title'>): string {
  const title = collapse(chapter.title)
  const ended = /[.!?…]$/.test(title) ? title : `${title}.`
  if (chapter.number === null) return ended
  const number = `Chapter ${chapter.number}.`
  return ended.toLowerCase() === number.toLowerCase() ? number : `${number} ${ended}`
}
