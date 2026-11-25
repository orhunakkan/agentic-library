import { citationMarker, cleanModelText, MARKER_CLOSE, MARKER_OPEN } from '~/shared/ask/events'

const MARKER = new RegExp(`${MARKER_OPEN}(\\d+)${MARKER_CLOSE}`, 'g')

export { citationMarker, cleanModelText }

export const readableCitation = (text: string) =>
  text
    .replace(/^```.*\n?/gm, '')
    .replace(/`([^`\n]+)`/g, '$1')
    .trim()

export const plainAnswer = (text: string) => text.replace(MARKER, '')

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'cite'; index: number }

export type Block =
  | { kind: 'p'; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; language: string; text: string }

function cites(text: string): Inline[] {
  return [...text.matchAll(MARKER)].map((m) => ({ kind: 'cite', index: Number(m[1]) }))
}

function textInlines(text: string, out: Inline[]) {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  parts.forEach((part, i) => {
    let last = 0
    for (const marker of part.matchAll(MARKER)) {
      const before = part.slice(last, marker.index)
      if (before) out.push({ kind: i % 2 ? 'strong' : 'text', text: before })
      out.push({ kind: 'cite', index: Number(marker[1]) })
      last = (marker.index ?? 0) + marker[0].length
    }
    const rest = part.slice(last)
    if (rest) out.push({ kind: i % 2 ? 'strong' : 'text', text: rest })
  })
}

export function parseInlines(text: string): Inline[] {
  const out: Inline[] = []
  const pieces = text.split(/`([^`]+)`/g)
  pieces.forEach((piece, i) => {
    if (i % 2) {
      out.push({ kind: 'code', text: plainAnswer(piece) }, ...cites(piece))
    } else if (piece) textInlines(piece, out)
  })
  return out
}

const FENCE = /^\s*```\s*([\w+-]*)\s*$/
const ITEM = /^\s*([-*+]|\d{1,3}[.)])\s+(.*)$/

export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'p', inlines: parseInlines(paragraph.join(' ')) })
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(parseInlines) })
    paragraph = []
    list = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const code: string[] = []
      while (++i < lines.length && !FENCE.test(lines[i] as string)) code.push(lines[i] as string)
      const raw = code.join('\n')
      blocks.push({ kind: 'code', language: fence[1] ?? '', text: plainAnswer(raw) })
      const after = cites(raw)
      if (after.length) blocks.push({ kind: 'p', inlines: after })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const item = ITEM.exec(line)
    if (item) {
      const ordered = /\d/.test(item[1] as string)
      if (paragraph.length || (list && list.ordered !== ordered)) flush()
      list ??= { ordered, items: [] }
      list.items.push(item[2] as string)
      continue
    }
    if (list) {
      list.items[list.items.length - 1] += ` ${line.trim()}`
      continue
    }
    paragraph.push(line.trim().replace(/^#{1,6}\s+/, ''))
  }
  flush()
  return blocks
}
