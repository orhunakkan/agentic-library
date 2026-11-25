import { decodeEntities } from '../../shared/content/html-text.ts'
import { isObject } from '../../shared/lib/json-shape.ts'
import type { Sense } from '../../shared/lookup/contract.ts'
import { englishName } from '../../shared/lookup/languages.ts'
import { lookupTerm } from '../../shared/lookup/term.ts'
import { sentenceSpans } from '../../shared/read-aloud/sentences.ts'

export const MAX_PARTS = 3
export const MAX_DEFINITIONS = 4
export const DEFINITION_MAX = 400
export const EXTRACT_MAX = 1_200

export interface ParsedDefinition {
  language: string
  languageName: string
  otherLanguage: boolean
  senses: Sense[]
}

export type ParsedSummary =
  | { kind: 'found'; title: string; description: string | null; extract: string; url: string }
  | { kind: 'ambiguous'; title: string; url: string }

const LANGUAGE_KEY = /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i

function cutText(text: string, max: number): string {
  const chars = [...text]
  if (chars.length <= max) return text
  const head = chars.slice(0, max - 1).join('')
  const space = head.lastIndexOf(' ')
  return `${(space > max * 0.6 ? head.slice(0, space) : head).trimEnd()}…`
}

export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(ol|ul|dl)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim()
}

function lemmaOf(html: string): string | undefined {
  const link = /class="[^"]*\bform-of-definition-link\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1]
  const title = link && /<a\b[^>]*\btitle="([^"]+)"/i.exec(link)?.[1]
  const lemma = title ? lookupTerm(decodeEntities(title)) : null
  return lemma ?? undefined
}

function senses(sections: unknown): { senses: Sense[]; name: string | null } {
  const out: Sense[] = []
  let name: string | null = null
  if (!Array.isArray(sections)) return { senses: out, name }
  for (const section of sections) {
    if (!isObject(section) || typeof section.partOfSpeech !== 'string' || !Array.isArray(section.definitions)) continue
    const partOfSpeech = htmlToText(section.partOfSpeech)
    if (!partOfSpeech) continue
    if (!name && typeof section.language === 'string') name = htmlToText(section.language) || null
    let sense = out.find((s) => s.partOfSpeech === partOfSpeech)
    if (!sense) {
      if (out.length >= MAX_PARTS) continue
      sense = { partOfSpeech, definitions: [] }
      out.push(sense)
    }
    for (const definition of section.definitions) {
      if (sense.definitions.length >= MAX_DEFINITIONS) break
      if (!isObject(definition) || typeof definition.definition !== 'string') continue
      const text = cutText(htmlToText(definition.definition), DEFINITION_MAX)
      if (!text) continue
      const lemma = lemmaOf(definition.definition)
      sense.definitions.push(lemma ? { text, lemma } : { text })
    }
  }
  return { senses: out.filter((s) => s.definitions.length > 0), name }
}

export function parseDefinition(json: unknown, lang: string): ParsedDefinition | null {
  if (!isObject(json)) return null
  const keys = Object.keys(json).filter((k) => LANGUAGE_KEY.test(k))
  const order = keys.includes(lang) ? [lang, ...keys.filter((k) => k !== lang)] : keys
  for (const key of order) {
    const found = senses(json[key])
    if (found.senses.length === 0) continue
    return {
      language: key,
      languageName: found.name ?? englishName(key),
      otherLanguage: key !== lang,
      senses: found.senses,
    }
  }
  return null
}

const isWebUrl = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\/[^\s]+$/.test(value)

export function cutExtract(extract: string, lang: string): string {
  const text = extract.replace(/\s+/g, ' ').trim()
  if (text.length <= EXTRACT_MAX) return text
  let end = 0
  for (const [, b] of sentenceSpans(text, lang)) {
    if (b > EXTRACT_MAX) break
    end = b
  }
  return end > 0 ? text.slice(0, end).trim() : cutText(text, EXTRACT_MAX)
}

export function parseSummary(json: unknown, lang: string): ParsedSummary | null {
  if (!isObject(json) || typeof json.title !== 'string') return null
  const title = htmlToText(json.title)
  const desktop = isObject(json.content_urls) && isObject(json.content_urls.desktop) ? json.content_urls.desktop : {}
  const url = desktop.page
  if (!title || !isWebUrl(url)) return null
  if (json.type === 'disambiguation') return { kind: 'ambiguous', title, url }
  if (json.type !== 'standard' || typeof json.extract !== 'string') return null
  const extract = cutExtract(json.extract, lang)
  if (!extract) return null
  const description = typeof json.description === 'string' ? htmlToText(json.description) || null : null
  return { kind: 'found', title, description, extract, url }
}
