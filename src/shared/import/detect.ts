import { type BookBlock, type DraftChapter, LANGUAGE_TAG } from './blocks.ts'
import type { HtmlItem } from './html.ts'
import { renderBlock } from './render.ts'

export const MIN_CHAPTERS = 3
export const MIN_MEDIAN_WORDS = 100

export type ChapterLevel = 1 | 2 | 3

export function splitChapters(items: readonly HtmlItem[], level: ChapterLevel): DraftChapter[] {
  const chapters: DraftChapter[] = []
  for (const item of items) {
    const current = chapters.at(-1)
    if (item.kind === 'heading') {
      if (item.level === level) chapters.push({ title: item.title, blocks: [] })
      else if (item.level > level && current) {
        const heading: BookBlock = { type: 'heading', level: item.level === level + 1 ? 3 : 4, runs: item.runs }
        if (renderBlock(heading)) current.blocks.push(heading)
      }
    } else current?.blocks.push(item.block)
  }
  return chapters.filter((c) => c.blocks.length)
}

export function singleChapter(items: readonly HtmlItem[], title: string): DraftChapter[] {
  const top = Math.min(...items.map((i) => (i.kind === 'heading' ? i.level : 7)))
  const blocks: BookBlock[] = []
  for (const item of items) {
    if (item.kind === 'block') blocks.push(item.block)
    else {
      const heading: BookBlock = { type: 'heading', level: item.level === top ? 3 : 4, runs: item.runs }
      if (renderBlock(heading)) blocks.push(heading)
    }
  }
  return blocks.length ? [{ title, blocks }] : []
}

export function chapterWords(chapter: DraftChapter): number {
  return chapter.blocks.reduce((n, b) => n + (renderBlock(b)?.words ?? 0), 0)
}

export function median(values: readonly number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

export function detectChapterLevel(items: readonly HtmlItem[]): ChapterLevel | null {
  for (const level of [1, 2, 3] as const) {
    const chapters = splitChapters(items, level)
    if (chapters.length >= MIN_CHAPTERS && median(chapters.map(chapterWords)) >= MIN_MEDIAN_WORDS) return level
  }
  return null
}

export function chaptersOf(
  items: readonly HtmlItem[],
  title: string,
  level?: ChapterLevel,
): { chapters: DraftChapter[]; level: ChapterLevel | null } {
  const chosen = level ?? detectChapterLevel(items)
  return chosen
    ? { chapters: splitChapters(items, chosen), level: chosen }
    : { chapters: singleChapter(items, title), level: null }
}

export function frontMatter(markdown: string): { fields: Record<string, string>; body: string } {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n?/.exec(markdown)
  if (!match) return { fields: {}, body: markdown }
  const fields: Record<string, string> = {}
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (pair?.[1] && pair[2]) fields[pair[1].toLowerCase()] = unquote(pair[2].trim())
  }
  return { fields, body: markdown.slice(match[0].length) }
}

function unquote(value: string): string {
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value
}

export function bookToml(toml: string): Record<string, string> {
  const fields: Record<string, string> = {}
  let section = ''
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim()
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      section = (header[1] ?? '').trim()
      continue
    }
    if (section !== 'book') continue
    const pair = /^(title|authors|language|description|isbn|publisher|date|year)\s*=\s*(.+)$/.exec(line)
    if (!pair?.[1] || !pair[2]) continue
    const value = pair[2].trim()
    if (pair[1] === 'authors') {
      const names = [...value.matchAll(/"([^"]*)"/g)].map((m) => m[1]).filter(Boolean)
      if (names.length) fields.author = names.join(', ')
    } else fields[pair[1]] = unquote(value)
  }
  return fields
}

export function languageTag(value: string | null | undefined): string | null {
  const tag = value?.trim().replace(/_/g, '-')
  return tag && LANGUAGE_TAG.test(tag) ? tag : null
}

export function titleFromFileName(name: string): string {
  const base = name.split('/').pop() ?? name
  return (
    base
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim() || 'Untitled'
  )
}
