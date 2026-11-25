import { collapse, sentenceSpans } from '../read-aloud/sentences.ts'
import { PASSAGE_MAX } from './term.ts'

const ELLIPSIS = '…'

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
  let cutStart = Math.max(from, middle - Math.floor(budget / 2))
  const cutEnd = Math.min(to, cutStart + budget)
  cutStart = Math.max(from, cutEnd - budget)
  if (isLowSurrogate(pageText, cutStart)) cutStart++
  const cut = pageText.slice(cutStart, isLowSurrogate(pageText, cutEnd) ? cutEnd - 1 : cutEnd)
  return `${cutStart > from ? ELLIPSIS : ''}${collapse(cut)}${cutEnd < to ? ELLIPSIS : ''}`
}
