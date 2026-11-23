import { sentenceSpans } from '../read-aloud/sentences.ts'
import { PASSAGE_MAX } from './term.ts'

const ELLIPSIS = '…'
const collapse = (text: string) => text.replace(/\s+/gu, ' ').trim()

const isLowSurrogate = (text: string, at: number) => /[\uDC00-\uDFFF]/.test(text[at] ?? '')

export function contextFor(
  pageText: string,
  start: number,
  end: number,
  lang: string,
  options: { intl?: boolean } = {},
): string {
  const spans = sentenceSpans(pageText, lang, options).filter(([a, b]) => a < end && b > start)
  const from = spans[0]?.[0] ?? start
  const to = spans.at(-1)?.[1] ?? end
  const whole = collapse(pageText.slice(from, to))
  if (whole.length <= PASSAGE_MAX) return whole

  const budget = PASSAGE_MAX - 2
  const middle = Math.floor((start + end) / 2)
  let a = Math.max(from, middle - Math.floor(budget / 2))
  const b = Math.min(to, a + budget)
  a = Math.max(from, b - budget)
  if (isLowSurrogate(pageText, a)) a++
  const cut = pageText.slice(a, isLowSurrogate(pageText, b) ? b - 1 : b)
  return `${a > from ? ELLIPSIS : ''}${collapse(cut)}${b < to ? ELLIPSIS : ''}`
}
