import { describe, expect, it } from 'vitest'
import {
  bookToml,
  chaptersOf,
  detectChapterLevel,
  frontMatter,
  languageTag,
  titleFromFileName,
} from '~/shared/import/detect'
import type { HtmlItem } from '~/shared/import/html'
import { words } from '../../../fixtures/zip'

const heading = (level: number, title: string): HtmlItem => ({ kind: 'heading', level, title, runs: [{ text: title }] })
const para = (count: number): HtmlItem => ({
  kind: 'block',
  block: { type: 'paragraph', runs: [{ text: words(count) }] },
})

describe('chapter level detection', () => {
  it('chooses the shallowest level with at least 3 chapters of a median 100 words or more', () => {
    const items = [
      heading(1, 'The Book'),
      ...['One', 'Two', 'Three'].flatMap((t) => [heading(2, t), para(60), heading(3, `${t}, part`), para(60)]),
    ]
    expect(detectChapterLevel(items)).toBe(2)
  })

  it('takes h1 when it qualifies, even if deeper levels do too', () => {
    const items = ['A', 'B', 'C'].flatMap((t) => [
      heading(1, t),
      heading(2, `${t}.1`),
      para(400),
      heading(2, `${t}.2`),
      para(400),
    ])
    expect(detectChapterLevel(items)).toBe(1)
  })

  it('uses the median, so one long chapter does not carry short ones', () => {
    const items = [heading(2, 'Long'), para(5000), heading(2, 'Short'), para(50), heading(2, 'Shorter'), para(40)]
    expect(detectChapterLevel(items)).toBeNull()
  })

  it('goes deeper only when the shallower level fails', () => {
    const parts = [heading(2, 'Part 1'), heading(3, 'a'), para(200), heading(3, 'b'), para(200)]
    const items = [...parts, heading(2, 'Part 2'), heading(3, 'c'), para(200)]
    expect(detectChapterLevel(items)).toBe(3)
  })

  it('needs at least three chapters', () => {
    expect(detectChapterLevel([heading(1, 'A'), para(900), heading(1, 'B'), para(900)])).toBeNull()
  })

  it('falls back to one chapter titled after the book, shallowest heading as h3', () => {
    const items = [para(10), heading(2, 'Section'), para(10), heading(4, 'Detail'), para(10)]
    const { chapters, level } = chaptersOf(items, 'Whole Book')
    expect(level).toBeNull()
    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.title).toBe('Whole Book')
    expect(chapters[0]?.blocks.map((b) => (b.type === 'heading' ? `h${b.level}` : b.type))).toEqual([
      'paragraph',
      'h3',
      'paragraph',
      'h4',
      'paragraph',
    ])
  })

  it('falls back to one chapter for a book of 200,000 items with no headings', () => {
    const items = Array.from({ length: 200_000 }, (): HtmlItem => para(1))
    const { chapters, level } = chaptersOf(items, 'Whole Book')
    expect(level).toBeNull()
    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.blocks).toHaveLength(200_000)
  })

  it('makes the smallest heading level present h3 in the fallback chapter, and deeper ones h4', () => {
    const items = [heading(3, 'C'), para(5), heading(2, 'B'), para(5), heading(5, 'E'), heading(2, 'B2'), para(5)]
    const { chapters, level } = chaptersOf(items, 'Whole Book')
    expect(level).toBeNull()
    expect(chapters[0]?.blocks.map((b) => (b.type === 'heading' ? `h${b.level}` : b.type))).toEqual([
      'h4',
      'paragraph',
      'h3',
      'paragraph',
      'h4',
      'h3',
      'paragraph',
    ])
  })

  it('splits at a given level: deeper headings become h3 and h4, front matter and empty chapters go', () => {
    const items = [
      para(5),
      heading(2, 'One'),
      para(5),
      heading(3, 'Sub'),
      heading(5, 'Deep'),
      para(5),
      heading(2, 'Empty'),
      heading(1, 'Shallower, dropped'),
      heading(2, 'Two'),
      para(5),
    ]
    const { chapters } = chaptersOf(items, 'ignored', 2)
    expect(chapters.map((c) => c.title)).toEqual(['One', 'Two'])
    expect(chapters[0]?.blocks.map((b) => (b.type === 'heading' ? `h${b.level}` : b.type))).toEqual([
      'paragraph',
      'h3',
      'h4',
      'paragraph',
    ])
  })
})

describe('metadata', () => {
  it('reads YAML front matter and returns the body after it', () => {
    const { fields, body } = frontMatter('---\ntitle: "My Book"\nauthor: Ada\nlang: tr\n---\n# Start\n')
    expect(fields).toEqual({ title: 'My Book', author: 'Ada', lang: 'tr' })
    expect(body).toBe('# Start\n')
    expect(frontMatter('# No front matter').fields).toEqual({})
  })

  it('reads the [book] table of an mdBook book.toml', () => {
    const toml =
      '[book]\ntitle = "Rust Notes"\nauthors = ["Ada", "Grace"]\nlanguage = "en"\n\n[output.html]\ntitle = "not this"\n'
    expect(bookToml(toml)).toEqual({ title: 'Rust Notes', author: 'Ada, Grace', language: 'en' })
  })

  it('accepts only language tags', () => {
    expect(languageTag('pt_BR')).toBe('pt-BR')
    expect(languageTag(' en ')).toBe('en')
    expect(languageTag('english please')).toBeNull()
    expect(languageTag(undefined)).toBeNull()
  })

  it('makes a title from a file name', () => {
    expect(titleFromFileName('books/my_great-book.md')).toBe('my great book')
    expect(titleFromFileName('.md')).toBe('Untitled')
  })
})
