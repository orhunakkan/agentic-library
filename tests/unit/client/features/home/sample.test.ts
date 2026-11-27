import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BOOK_TITLE,
  CHAPTER_COUNT,
  FEATURE_ASK,
  HIGHLIGHTS,
  label,
  OPENING,
  type Passage,
  type Place,
  READ_ALOUD,
  READER_ASK,
} from '~/client/features/home/sample'
import { CHARS_PER_SECOND } from '~/client/features/read-aloud/cursor'
import type { ChapterBook } from '~/shared/content/schema'
import { bookPages } from '~/shared/highlights/page-text'
import { utterances } from '~/shared/read-aloud/sentences'
import { speechChapter } from '~/shared/read-aloud/speech-text'

const book = JSON.parse(readFileSync('tests/fixtures/content/books/pride-and-prejudice.json', 'utf8')) as ChapterBook
const catalog = JSON.parse(readFileSync('tests/fixtures/content/catalog/novels.json', 'utf8')) as {
  books: { title: string }[]
}
const pages = bookPages(book)

const pageAt = (p: Place) => pages.find((x) => x.chapterIndex === p.chapter - 1 && x.page === p.page)

const passages: Passage[] = [...OPENING, READER_ASK.quote, FEATURE_ASK.quote, ...HIGHLIGHTS.items.map((h) => h.passage)]

describe('the home page sample', () => {
  it('names the book the library holds, with its real chapter count', () => {
    expect(catalog.books.map((b) => b.title)).toContain(BOOK_TITLE)
    expect(book.chapters).toHaveLength(CHAPTER_COUNT)
  })

  it('quotes every passage word for word from the page its label names', () => {
    for (const passage of passages) {
      const page = pageAt(passage)
      expect(page, label(passage)).toBeDefined()
      expect(page?.text, label(passage)).toContain(passage.text)
    }
  })

  it('shows the reader page’s opening paragraphs in the book’s order, from its start', () => {
    const page = pageAt(OPENING[0])
    expect(page?.text.startsWith(OPENING.map((p) => p.text).join(''))).toBe(true)
  })

  it('labels pages as the reader does, and only pages the book has', () => {
    for (const place of [...passages, READER_ASK.scope, FEATURE_ASK.scope]) {
      expect(pageAt(place)?.label, JSON.stringify(place)).toBe(label(place))
    }
    expect(label({ chapter: 3, page: 2 })).toBe('Ch. 3 · p. 2')
    expect(pageAt({ ...FEATURE_ASK.scope, page: FEATURE_ASK.scope.page + 1 })).toBeUndefined()
  })

  it('says the minutes left in the read-aloud chapter as the player works them out', () => {
    const chapter = speechChapter(book, READ_ALOUD.chapter - 1)
    expect(chapter?.title).toBe(READ_ALOUD.title)
    const chars = (chapter?.pages ?? []).flatMap((p) => utterances(p, 'en-GB')).reduce((n, u) => n + u.say.length, 0)
    expect(READ_ALOUD.minutesLeft).toBe(Math.ceil(chars / CHARS_PER_SECOND / 60))
  })
})
