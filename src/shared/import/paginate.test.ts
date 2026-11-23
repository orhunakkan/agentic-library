import { describe, expect, it } from 'vitest'
import { PAGE_MAX, PAGE_MIN, paginate } from './paginate'
import type { Block } from './render'

function blocks(...specs: (number | 'h')[]): Block[] {
  return specs.map((spec, i) =>
    spec === 'h'
      ? { html: `<h2 data-b="${i}">H</h2>`, words: 1, heading: true }
      : { html: `<p data-b="${i}">${spec}</p>`, words: spec, heading: false },
  )
}

function pageBlocks(pages: string[], source: Block[]): number[][] {
  return pages.map((page) => {
    const parts = page.match(/<(p|h2) data-b="\d+">[^<]*<\/\1>/g) ?? []
    expect(parts.join('')).toBe(page)
    return parts.map((part) => source.findIndex((b) => b.html === part))
  })
}

function pageWords(pages: string[], source: Block[]): number[] {
  return pageBlocks(pages, source).map((ids) => ids.reduce((sum, id) => sum + (source[id]?.words ?? 0), 0))
}

describe('paginate', () => {
  it('makes no pages from an empty chapter (handleChapter turns that into a 400)', () => {
    expect(paginate([])).toEqual([])
  })

  it('keeps a chapter of at most PAGE_MAX words on one page, in order', () => {
    const source = blocks(200, 'h', 300, PAGE_MAX - 501)
    expect(paginate(source)).toEqual([source.map((b) => b.html).join('')])
  })

  it('lands every page in the 450–650 word range when the blocks allow it', () => {
    const source = blocks(...Array.from({ length: 40 }, () => 60))
    const words = pageWords(paginate(source), source)
    expect(words.length).toBeGreaterThan(1)
    for (const count of words) {
      expect(count).toBeGreaterThanOrEqual(PAGE_MIN)
      expect(count).toBeLessThanOrEqual(PAGE_MAX)
    }
  })

  it('breaks only between blocks, and keeps every block once and in order', () => {
    const source = blocks(120, 333, 90, 410, 75, 260, 515, 40, 300)
    const pages = paginate(source)
    expect(pages.join('')).toBe(source.map((b) => b.html).join(''))
    expect(pageBlocks(pages, source).flat()).toEqual(source.map((_, i) => i))
  })

  it('puts one block over PAGE_MAX on a page of its own', () => {
    const source = blocks(500, 1000, 500)
    expect(pageBlocks(paginate(source), source)).toEqual([[0], [1], [2]])
  })

  it('never joins a block to an oversized one past three pages of words', () => {
    const source = blocks(2000, 10)
    expect(pageBlocks(paginate(source), source)).toEqual([[0], [1]])
  })

  it('picks the least-deviation partition, not greedy-full-then-tiny', () => {
    const source = blocks(100, 100, 100, 100, 100, 100, 100, 100)
    expect(pageWords(paginate(source), source)).toEqual([400, 400])
  })

  it('never ends a page on a heading when another break exists', () => {
    const source = blocks(649, 'h', 650)
    expect(pageBlocks(paginate(source), source)).toEqual([[0], [1, 2]])
  })
})
