import { isNotFound } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { loadSpeechChapterData, speechInput } from './read-aloud'

vi.mock('@tanstack/react-start/server', () => ({ getRequest: () => new Request('http://localhost/read/x') }))

describe('speechInput', () => {
  it('takes a book slug and a 0-based chapter index', () => {
    expect(speechInput({ book: 'pride-and-prejudice', chapter: 0 })).toEqual({
      book: 'pride-and-prejudice',
      chapter: 0,
    })
  })

  it.each([
    [{ book: '', chapter: 0 }, 'Invalid book'],
    [{ book: 'x'.repeat(201), chapter: 0 }, 'Invalid book'],
    [{ book: 3, chapter: 0 }, 'Invalid book'],
    [{ book: 'b', chapter: -1 }, 'Invalid chapter'],
    [{ book: 'b', chapter: 1.5 }, 'Invalid chapter'],
    [{ book: 'b', chapter: '2' }, 'Invalid chapter'],
    [{ book: 'b', chapter: 100_001 }, 'Invalid chapter'],
    [{ book: 'b' }, 'Invalid chapter'],
  ])('refuses %o', (data, message) => {
    expect(() => speechInput(data)).toThrow(message)
  })
})

describe('loadSpeechChapterData', () => {
  it("gives a catalogue chapter's pages and the book as the dock shows it", async () => {
    const data = await loadSpeechChapterData('pride-and-prejudice', 2)
    expect(data.book).toMatchObject({
      slug: 'pride-and-prejudice',
      title: 'Pride and Prejudice',
      href: '/library/jane-austen/pride-and-prejudice',
      language: 'en-GB',
    })
    expect(data.book.coverUrl).toMatch(/^\/covers\/pride-and-prejudice-[0-9a-f]{8}\.jpg$/)
    expect(data.book.image).toMatchObject({ src: data.book.coverUrl, width: 1400, height: 2100 })
    expect(data.book.chapterTitles).toHaveLength(61)
    expect(data.book.chapterTitles.slice(0, 2)).toEqual(['Chapter 1', 'Chapter 2'])
    expect(data.chapter).toMatchObject({ index: 2, number: 3, title: 'Chapter 3', slug: 'chapter-3' })
    expect(data.chapter.pages[0]?.href).toBe('/read/pride-and-prejudice/chapter-3')
    expect(data.chapter.pages.every((p) => p.blocks.length > 0)).toBe(true)
  })

  it('is a 404 for an unknown book, a chapter out of range and a private book without its owner', async () => {
    await expect(loadSpeechChapterData('no-such-book', 0)).rejects.toSatisfy(isNotFound)
    await expect(loadSpeechChapterData('pride-and-prejudice', 999)).rejects.toSatisfy(isNotFound)
    await expect(loadSpeechChapterData('u-00000000-0000-4000-8000-000000000000', 0)).rejects.toSatisfy(isNotFound)
  })
})
