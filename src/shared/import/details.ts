import { decodeEntities } from '../content/html-text.ts'
import { DESCRIPTION_MAX } from './limits.ts'

export interface BookDetails {
  description: string | null
  isbn: string | null
  publisher: string | null
  publishedYear: number | null
}

export const NO_DETAILS: BookDetails = { description: null, isbn: null, publisher: null, publishedYear: null }

const range = (from: number, to: number) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`
const CONTROL = new RegExp(
  `[${range(0, 0x08)}${range(0x0b, 0x1f)}${range(0x7f, 0x9f)}${range(0x202a, 0x202e)}${range(0x2066, 0x2069)}]`,
  'g',
)
const TAG = /<\/?[a-z][a-z0-9]*(?:\s[^>]*)?\/?>/gi
const BLOCK_TAG = /<\/?(?:p|div|h[1-6]|li|ul|ol|blockquote|section|article|tr|table|dl|dt|dd|hr)\b[^>]*>/gi

function plainText(value: string): string {
  let text = value.normalize('NFC').replace(/\r\n?/g, '\n')
  if (/&lt;\/?[a-z][a-z0-9]*(?:\s|&gt;|\/)/i.test(text)) text = decodeEntities(text)
  if (TAG.test(text)) {
    TAG.lastIndex = 0
    text = text
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/\n(?![ \t]*\n)(?<!\n[ \t]*\n)/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(BLOCK_TAG, '\n\n')
      .replace(TAG, '')
  }
  return decodeEntities(text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$/gm, '')
    .replace(CONTROL, '')
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, max - 1)
  const space = head.search(/\s\S*$/)
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`
}

export function cleanDescription(value: string | null | undefined, { cap = true } = {}): string | null {
  if (!value) return null
  const text = plainText(value)
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
  if (!text) return null
  return cap ? cut(text, DESCRIPTION_MAX) : text
}

export function yearFrom(value: string | null | undefined, now = new Date()): number | null {
  if (!value) return null
  const latest = now.getUTCFullYear() + 1
  for (const match of value.matchAll(/(?<!\d)\d{4}(?!\d)/g)) {
    const year = Number(match[0])
    if (year >= 1 && year <= latest) return year
  }
  return null
}

export const paragraphs = (description: string): string[] =>
  description
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
