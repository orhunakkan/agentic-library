import { CODE_SAY, collapse, cutLong, sentenceSpans } from '~/shared/read-aloud/sentences'
import { type Inline, parseAnswer } from '../ask/answer-format'

const HAS_WORD = /[\p{L}\p{N}]/u
const HAS_LETTER = /\p{L}/u

function plainWords(inlines: readonly Inline[]): string {
  return inlines
    .map((piece) => (piece.kind === 'cite' ? '' : piece.text))
    .join('')
    .replace(/[*`]/g, '')
}

function sentencesOf(text: string, lang: string, open: boolean): string[] {
  const spans = sentenceSpans(text, lang)
  const out: string[] = []
  for (let i = 0; i < spans.length; i++) {
    if (open) {
      const after = spans[i + 1]
      if (!after || !HAS_LETTER.test(text.slice(after[0], after[1]))) break
    }
    const [start, end] = spans[i] as [number, number]
    for (const [s, e] of cutLong(text, start, end)) {
      const say = collapse(text.slice(s, e))
      if (HAS_WORD.test(say)) out.push(say)
    }
  }
  return out
}

function speechOf(text: string, lang: string, done: boolean): string[] {
  const blocks = parseAnswer(text)
  const out: string[] = []
  blocks.forEach((block, b) => {
    const growing = !done && b === blocks.length - 1
    if (block.kind === 'code') {
      if (!growing && block.text.trim()) out.push(CODE_SAY)
      return
    }
    const units = block.kind === 'p' ? [block.inlines] : block.items
    units.forEach((inlines, u) => {
      out.push(...sentencesOf(plainWords(inlines), lang, growing && u === units.length - 1))
    })
  })
  return out
}

export const answerSpeech = (text: string, lang: string): string[] => speechOf(text, lang, true)

export interface SpeechFeed {
  push: (textSoFar: string) => string[]
  end: () => string[]
}

export function createSpeechFeed(lang: string): SpeechFeed {
  let said = 0
  let text = ''
  const take = (all: string[]) => {
    const fresh = all.slice(said)
    said = Math.max(said, all.length)
    return fresh
  }
  return {
    push: (textSoFar) => {
      text = textSoFar
      return take(speechOf(text, lang, false))
    },
    end: () => take(speechOf(text, lang, true)),
  }
}
