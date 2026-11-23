import { readFileSync } from 'node:fs'
import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import type { ChapterBook, PagedBook } from '~/shared/content/schema'
import type { HighlightView } from '~/shared/highlights/group'
import { type BookText, bookText } from './book-text'
import {
  ASK_HIGHLIGHT_CHARS,
  ASK_HIGHLIGHTS_MAX,
  ASK_HIGHLIGHTS_TOTAL,
  actionPart,
  askMessages,
  type BookContext,
  buildContext,
  CHARS_PER_TOKEN,
  CITED_TEXT_MAX,
  citationLink,
  highlightsForAsk,
  MAX_BOOK_TOKENS,
  pageIndexAt,
  positionAt,
  promptPart,
  STUDY_MIN_CHARS,
  STUDY_TWO_CHAPTERS_UNDER,
  SYSTEM_PROMPT,
  studyScope,
} from './context'

const pride = bookText(
  JSON.parse(readFileSync('tests/e2e/content/books/pride-and-prejudice.json', 'utf8')) as ChapterBook,
)
const ghazzali = bookText(
  JSON.parse(readFileSync('tests/e2e/content/books/confessions-of-al-ghazzali.json', 'utf8')) as PagedBook,
)
const code = bookText(JSON.parse(readFileSync('tests/e2e/content/books/fixture-code-book.json', 'utf8')) as ChapterBook)
const TITLE = 'Pride and Prejudice'

function built(text: BookText, pageIndex: number, wholeBook = false): BookContext {
  const result = buildContext(text, pageIndex, { bookTitle: TITLE, wholeBook })
  if (!result.ok) throw new Error(result.reason)
  return result.context
}

function blocks(doc: Anthropic.Beta.BetaRequestDocumentBlock | undefined): string[] {
  const source = doc?.source
  if (source?.type !== 'content' || typeof source.content === 'string') throw new Error('not a content document')
  return source.content.map((b) => (b.type === 'text' ? b.text : ''))
}

const at = (chapter: string, page: number) => pageIndexAt(pride, { chapter, page }) as number

describe('pageIndexAt', () => {
  it('finds a chapter book page by chapter slug and screen page', () => {
    const index = at('chapter-3', 2)
    expect(pride.pages[index]?.href).toBe('/read/pride-and-prejudice/chapter-3/2')
  })

  it('finds a paged book page by printed page', () => {
    const index = pageIndexAt(ghazzali, { printedPage: 14 }) as number
    expect(ghazzali.pages[index]?.label).toBe('p. 14')
  })

  it('refuses positions the book does not have', () => {
    const pages = pride.chapters[2]?.pageCount ?? 0
    expect(pageIndexAt(pride, { chapter: 'nope', page: 1 })).toBeNull()
    expect(pageIndexAt(pride, { chapter: 'chapter-3', page: 0 })).toBeNull()
    expect(pageIndexAt(pride, { chapter: 'chapter-3', page: pages + 1 })).toBeNull()
    expect(pageIndexAt(pride, { chapter: 'chapter-3', page: 1.5 })).toBeNull()
    expect(pageIndexAt(pride, { printedPage: 7 })).toBeNull()
    expect(pageIndexAt(ghazzali, { printedPage: 6 })).toBeNull()
    expect(pageIndexAt(ghazzali, { chapter: 'introduction', page: 1 })).toBeNull()
  })
})

describe('buildContext, scoped to the reader position', () => {
  it('sends only the current chapter on the first page of the book, uncached', () => {
    const context = built(pride, 0)
    expect(context.documents).toHaveLength(1)
    const [doc] = context.documents
    expect(doc?.cache_control).toBeUndefined()
    expect(doc?.citations).toEqual({ enabled: true })
    expect(doc?.title).toBe("Pride and Prejudice: chapter 1, up to the reader's page")
    const sent = blocks(doc)
    expect(sent).toHaveLength(pride.pages[0]?.blocks.length ?? -1)
    expect(sent[0]?.startsWith('Chapter 1: Chapter 1, page 1\n\n')).toBe(true)
  })

  it('mid-chapter: earlier chapters in a cached document, the current chapter up to this page in another', () => {
    const index = at('chapter-3', 2)
    const context = built(pride, index)
    const [earlier, current] = context.documents
    expect(context.documents).toHaveLength(2)
    expect(earlier?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
    expect(earlier?.title).toBe('Pride and Prejudice: chapters 1–2')
    expect(current?.cache_control).toBeUndefined()
    expect(current?.title).toBe("Pride and Prejudice: chapter 3, up to the reader's page")

    const start = pride.chapters[2]?.firstPage ?? -1
    const before = pride.pages.slice(0, start)
    expect(blocks(earlier)).toHaveLength(before.reduce((n, p) => n + p.blocks.length, 0))
    const upTo = pride.pages.slice(start, index + 1)
    expect(blocks(current)).toHaveLength(upTo.reduce((n, p) => n + p.blocks.length, 0))
    expect(blocks(current).filter((b) => b.startsWith('Chapter 3: Chapter 3, page '))).toHaveLength(2)
    const next = pride.pages[index + 1]?.blocks[0] as string
    expect(context.documents.flatMap(blocks).some((b) => b.includes(next))).toBe(false)
  })

  it('keeps the cached document identical while the reader turns pages in a chapter', () => {
    const one = built(pride, at('chapter-3', 1)).documents[0]
    const three = built(pride, at('chapter-3', 3)).documents[0]
    expect(three).toEqual(one)
  })

  it('on the last page sends every page, and the second document ends there', () => {
    const last = pride.pages.length - 1
    const context = built(pride, last)
    const total = pride.pages.reduce((n, p) => n + p.blocks.length, 0)
    expect(context.documents.flatMap(blocks)).toHaveLength(total)
    expect(context.table[1]?.at(-1)?.page.href).toBe(pride.pages[last]?.href)
  })

  it('splits a paged book at the chapter that holds the printed page', () => {
    const context = built(ghazzali, pageIndexAt(ghazzali, { printedPage: 15 }) as number)
    expect(context.table.map((doc) => [...new Set(doc.map((b) => b.page.printedPage))])).toEqual([
      [7, 8, 9, 10, 11, 12, 13],
      [14, 15],
    ])
  })
})

describe('buildContext with the whole book', () => {
  it('sends one cached document with every page, the same at any position', () => {
    const first = built(pride, 0, true)
    const later = built(pride, at('chapter-3', 2), true)
    expect(first.documents).toHaveLength(1)
    expect(first.documents[0]?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
    expect(first.documents[0]?.title).toBe('Pride and Prejudice: the whole book')
    expect(blocks(first.documents[0])).toHaveLength(pride.pages.reduce((n, p) => n + p.blocks.length, 0))
    expect(later.documents).toEqual(first.documents)
  })

  it('estimates Pride and Prejudice well inside the limit', () => {
    const context = built(pride, 0, true)
    expect(context.estimatedTokens).toBe(Math.ceil(context.chars / CHARS_PER_TOKEN))
    expect(context.estimatedTokens).toBeGreaterThan(200_000)
    expect(context.estimatedTokens).toBeLessThan(MAX_BOOK_TOKENS / 2)
  })
})

describe('the size limit', () => {
  const huge: BookText = {
    kind: 'chapter',
    chapters: [
      { title: 'One', slug: 'one', firstPage: 0, pageCount: 10 },
      { title: 'Two', slug: 'two', firstPage: 10, pageCount: 10 },
    ],
    pages: Array.from({ length: 20 }, (_, i) => ({
      href: `/read/huge/${i < 10 ? 'one' : 'two'}/${(i % 10) + 1}`,
      label: `Ch. ${i < 10 ? 1 : 2} · p. ${(i % 10) + 1}`,
      heading: `Chapter ${i < 10 ? 1 : 2}, page ${(i % 10) + 1}`,
      chapterIndex: i < 10 ? 0 : 1,
      printedPage: null,
      blocks: ['x'.repeat(120_000)],
    })),
  }

  it('refuses a request whose book text is estimated over the limit', () => {
    expect(buildContext(huge, 19, { bookTitle: 'Huge', wholeBook: false })).toEqual({ ok: false, reason: 'too_long' })
    expect(buildContext(huge, 0, { bookTitle: 'Huge', wholeBook: true })).toEqual({ ok: false, reason: 'too_long' })
  })

  it('still answers early in the same book, where less of it is sent', () => {
    expect(buildContext(huge, 3, { bookTitle: 'Huge', wholeBook: false }).ok).toBe(true)
  })
})

describe('citationLink', () => {
  const context = built(pride, at('chapter-3', 2))
  const currentStart = pride.chapters[2]?.firstPage ?? -1
  const page1 = pride.pages[currentStart]
  const page2 = pride.pages[currentStart + 1]

  it('links a citation to the page of its block, with the page text as cited text', () => {
    const link = citationLink(context, { document_index: 1, start_block_index: 0, end_block_index: 1 })
    expect(link).toEqual({
      pageHref: '/read/pride-and-prejudice/chapter-3',
      label: 'Ch. 3 · p. 1',
      citedText: expect.any(String),
    })
    expect(link?.citedText.startsWith('Chapter 3')).toBe(false)
    expect(page1?.blocks[0]?.startsWith(link?.citedText.replace(/…$/, '') ?? '?')).toBe(true)
  })

  it('uses the first block when a citation spans pages, and joins the blocks it covers', () => {
    const last = page1?.blocks.length ?? 0
    const link = citationLink(context, { document_index: 1, start_block_index: last - 1, end_block_index: last + 1 })
    expect(link?.pageHref).toBe(page1?.href)
    const joined = `${page1?.blocks.at(-1)}\n\n${page2?.blocks[0]}`
    expect(link?.citedText).toEqual(joined.length <= CITED_TEXT_MAX ? joined : expect.stringMatching(/…$/))
    expect(joined.startsWith(link?.citedText.replace(/…$/, '') ?? '?')).toBe(true)
  })

  it('maps the earlier-chapters document too', () => {
    const link = citationLink(context, { document_index: 0, start_block_index: 0, end_block_index: 1 })
    expect(link?.pageHref).toBe('/read/pride-and-prejudice/chapter-1')
  })

  it('cuts long cited text near the limit, at a word', () => {
    const whole = built(pride, 0, true)
    const long = whole.table[0]?.findIndex((b) => b.text.length > CITED_TEXT_MAX + 50) ?? -1
    expect(long).toBeGreaterThanOrEqual(0)
    const link = citationLink(whole, { document_index: 0, start_block_index: long, end_block_index: long + 1 })
    expect(link?.citedText.length).toBeLessThanOrEqual(CITED_TEXT_MAX + 1)
    expect(link?.citedText.endsWith('…')).toBe(true)
  })

  it('drops citations that point outside what was sent', () => {
    const size = context.table[1]?.length ?? 0
    for (const bad of [
      { document_index: 2, start_block_index: 0, end_block_index: 1 },
      { document_index: -1, start_block_index: 0, end_block_index: 1 },
      { document_index: 1, start_block_index: size, end_block_index: size + 1 },
      { document_index: 1, start_block_index: 0, end_block_index: size + 1 },
      { document_index: 1, start_block_index: 2, end_block_index: 2 },
      { document_index: 1, start_block_index: -1, end_block_index: 1 },
      { document_index: 1, start_block_index: 0.5, end_block_index: 1 },
    ]) {
      expect(citationLink(context, bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('cites a table or a code block of the fixture code book whole, with its text as the passage', () => {
    const whole = built(code, code.pages.length - 1, true)
    const blocksSent = whole.table[0] ?? []
    const table = blocksSent.findIndex((b) => b.text.includes('count') && b.text.includes('boolean'))
    const listing = blocksSent.findIndex((b) => b.text.startsWith('```\nlet ten = 10;'))
    expect(citationLink(whole, { document_index: 0, start_block_index: table, end_block_index: table + 1 })).toEqual({
      pageHref: '/read/fixture-code-book/lists-and-tables',
      label: 'Ch. 2 · p. 1',
      citedText: blocksSent[table]?.text,
    })
    const cited = citationLink(whole, { document_index: 0, start_block_index: listing, end_block_index: listing + 1 })
    expect(cited?.pageHref).toBe('/read/fixture-code-book/values-and-names/2')
    expect(cited?.citedText).toBe('```\nlet ten = 10;\nconsole.log(ten * ten);\n// → 100\n```')
  })

  it('counts document indices over the documents actually sent', () => {
    const first = built(pride, 1)
    expect(citationLink(first, { document_index: 0, start_block_index: 0, end_block_index: 1 })?.label).toBe(
      'Ch. 1 · p. 1',
    )
    expect(citationLink(first, { document_index: 1, start_block_index: 0, end_block_index: 1 })).toBeNull()
  })
})

describe('highlightsForAsk', () => {
  let n = 0
  const view = (
    chapterIndex: number,
    position: number,
    text = `passage ${++n}`,
    note: string | null = null,
    status: HighlightView['status'] = 'ok',
  ): HighlightView => ({
    id: `h${n}-${position}`,
    color: 'yellow',
    note,
    text,
    status,
    place:
      status === 'missing'
        ? null
        : {
            chapterIndex,
            chapterTitle: 'Functions',
            chapter: 'functions',
            page: position + 1,
            pageHref: '',
            href: '',
            label: `Ch. ${chapterIndex + 1} · p. ${position + 1}`,
            position,
            start: 0,
            end: text.length,
          },
    createdAt: `2026-11-04T10:00:${String(n % 60).padStart(2, '0')}.000Z`,
    updatedAt: '2026-11-04T10:00:00.000Z',
  })

  it('keeps the current chapter up to the reader’s page, in reading order', () => {
    const list = [view(1, 7, 'later'), view(0, 1, 'earlier chapter'), view(1, 5, 'here'), view(1, 3, 'before')]
    expect(highlightsForAsk(list, { chapterIndex: 1, pageIndex: 5 }, false).map((h) => h.text)).toEqual([
      'before',
      'here',
    ])
  })

  it('takes the whole chapter with the whole book, and never a missing passage', () => {
    const list = [view(1, 7, 'later'), view(1, 3, 'before'), view(1, 4, 'gone', null, 'missing'), view(2, 9, 'next')]
    expect(highlightsForAsk(list, { chapterIndex: 1, pageIndex: 5 }, true).map((h) => h.text)).toEqual([
      'before',
      'later',
    ])
  })

  it('sends at most the 50 nearest the reader’s page, and cuts long passages and notes', () => {
    const many = Array.from({ length: 60 }, (_, i) => view(0, i, `p${i}`))
    const picked = highlightsForAsk(many, { chapterIndex: 0, pageIndex: 59 }, false)
    expect(picked).toHaveLength(ASK_HIGHLIGHTS_MAX)
    expect(picked[0]?.text).toBe('p10')
    const [long] = highlightsForAsk(
      [view(0, 0, 'x'.repeat(3000), 'y'.repeat(3000))],
      { chapterIndex: 0, pageIndex: 0 },
      false,
    )
    expect([...(long?.text ?? '')]).toHaveLength(ASK_HIGHLIGHT_CHARS)
    expect(long?.note?.endsWith('…')).toBe(true)
  })

  it('keeps to 12,000 characters, dropping the earliest first', () => {
    const big = Array.from({ length: 10 }, (_, i) => view(0, i, `${i}${'x'.repeat(999)}`, 'n'.repeat(500)))
    const picked = highlightsForAsk(big, { chapterIndex: 0, pageIndex: 9 }, false)
    expect(picked.reduce((t, h) => t + h.text.length + (h.note?.length ?? 0), 0)).toBeLessThanOrEqual(
      ASK_HIGHLIGHTS_TOTAL,
    )
    expect(picked.at(-1)?.text.startsWith('9')).toBe(true)
    expect(picked[0]?.text.startsWith('2')).toBe(true)
  })
})

describe('askMessages with highlights', () => {
  const input = {
    context: built(pride, at('chapter-4', 2)),
    wholeBook: false,
    where: 'page 2 of chapter 4',
    question: 'Explain my highlights in this chapter.',
    quote: null,
    history: [],
  }
  const last = (messages: Anthropic.Beta.BetaMessageParam[]) => messages.at(-1)?.content as string

  it('adds the highlights and notes before the question', () => {
    const text = last(
      askMessages({
        ...input,
        highlights: [
          { label: 'Ch. 4 · p. 1', text: 'A passage.', note: 'My note.' },
          { label: 'Ch. 4 · p. 2', text: 'Another.', note: null },
        ],
      }),
    )
    expect(text).toContain(
      'These are the passages the reader highlighted in this chapter, in reading order, with the page each is on and the reader’s own note when there is one:\n<highlights>\n<highlight page="Ch. 4 · p. 1">\nA passage.\n</highlight>\n<note>\nMy note.\n</note>\n<highlight page="Ch. 4 · p. 2">\nAnother.\n</highlight>\n</highlights>'.replace(
        '’',
        "'",
      ),
    )
    expect(text.indexOf('<highlights>')).toBeLessThan(text.indexOf('Their question:'))
  })

  it('adds nothing without highlights', () => {
    expect(last(askMessages(input))).not.toContain('<highlights>')
    expect(last(askMessages({ ...input, highlights: [] }))).not.toContain('<highlights>')
  })
})

describe('askMessages with an action', () => {
  const input = {
    context: built(pride, at('chapter-4', 2)),
    wholeBook: false,
    where: 'page 2 of chapter 4',
    question: 'Explain this passage in plain words.',
    quote: 'Elizabeth, feeling really anxious, was determined to go to her.',
    history: [],
  }
  const last = (messages: Anthropic.Beta.BetaMessageParam[]) => messages.at(-1)?.content as string
  const EXPLAIN =
    'Explain the selected passage in plain words, for someone meeting it for the first time: what it says, and what it means at this point in the book. Explain any word, name, reference or idea in it that a newcomer might not know. If the passage is code, say what it does. Use earlier pages where they help, and cite them. Keep it short: a short paragraph, or a short list when there are several terms to explain.'
  const SUMMARY_SO_FAR =
    "Summarise the current chapter from its start up to the reader's page: its main events or ideas, in order. Write a short paragraph, then at most six bullet points. Cite the pages you draw on. Say briefly that the summary stops at their page."
  const SUMMARY_WHOLE =
    'Summarise the whole of the current chapter, from its start to its end: its main events or ideas, in order. Write a short paragraph, then at most six bullet points. Cite the pages you draw on.'
  const RECAP =
    "Recap the book from its start up to the reader's page, for a reader coming back after a break: the main events, people and ideas in order. Keep earlier chapters brief and give more to the chapter they are in, then end with where things stand on their page. At most about 300 words. Cite the pages you draw on. Even if the documents hold the whole book, stop at the reader's page and don't hint at anything after it."
  const DEFINE =
    "The reader looked up a word or phrase in the selected passage; their question names it. Say what it means here, at this point in the book, in one or two sentences: the sense it has in this passage, and anything a newcomer to the book or its subject would need to know about it. If the book has used it before in another sense, add one line on that and cite the page. Don't retell the passage."
  const request = (kind: string, text: string) =>
    `This is a fixed request from a button in the reader:\n<request kind="${kind}">\n${text}\n</request>`

  it('puts the request after the passage and the highlights, and before the question', () => {
    const text = last(
      askMessages({
        ...input,
        action: 'explain',
        highlights: [{ label: 'Ch. 4 · p. 1', text: 'A passage.', note: null }],
      }),
    )
    const order = ['<passage>', '<highlights>', '<request kind="explain">', 'Their question:'].map((t) =>
      text.indexOf(t),
    )
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('sends each action’s text word for word', () => {
    expect(last(askMessages({ ...input, action: 'explain' }))).toContain(request('explain', EXPLAIN))
    expect(actionPart('explain', true)).toBe(request('explain', EXPLAIN))
    expect(last(askMessages({ ...input, quote: null, action: 'summary' }))).toContain(
      request('summary', SUMMARY_SO_FAR),
    )
    expect(last(askMessages({ ...input, quote: null, action: 'recap' }))).toContain(request('recap', RECAP))
    expect(last(askMessages({ ...input, action: 'define' }))).toContain(request('define', DEFINE))
  })

  it('summarises the whole chapter only with the whole book', () => {
    expect(actionPart('summary', false)).toBe(request('summary', SUMMARY_SO_FAR))
    expect(actionPart('summary', true)).toBe(request('summary', SUMMARY_WHOLE))
    const whole = built(pride, at('chapter-4', 2), true)
    expect(last(askMessages({ ...input, context: whole, wholeBook: true, quote: null, action: 'summary' }))).toContain(
      SUMMARY_WHOLE,
    )
  })

  it('tells the recap to stop at the reader’s page, with or without the whole book', () => {
    for (const wholeBook of [false, true]) {
      expect(actionPart('recap', wholeBook)).toBe(request('recap', RECAP))
      expect(actionPart('recap', wholeBook)).toContain("stop at the reader's page")
    }
  })

  it('adds nothing without an action', () => {
    expect(last(askMessages(input))).not.toContain('<request')
    expect(last(askMessages({ ...input, action: null }))).not.toContain('<request')
  })

  it('leaves the first message, the cached prefix, the same with or without an action', () => {
    const plain = askMessages(input)[0]
    for (const action of ['explain', 'summary', 'recap', 'define'] as const) {
      expect(askMessages({ ...input, action })[0]).toEqual(plain)
    }
    const whole = { ...input, context: built(pride, at('chapter-4', 2), true), wholeBook: true }
    expect(askMessages({ ...whole, quote: null, action: 'summary' })[0]).toEqual(askMessages(whole)[0])
  })
})

describe('askMessages with a saved prompt', () => {
  const input = {
    context: built(pride, at('chapter-4', 2)),
    wholeBook: false,
    where: 'page 2 of chapter 4',
    question: 'Explain like I’m new',
    quote: 'Elizabeth, feeling really anxious, was determined to go to her.',
    history: [{ role: 'user' as const, text: 'Who is Jane?' }],
  }
  const last = (messages: Anthropic.Beta.BetaMessageParam[]) => messages.at(-1)?.content as string
  const PROMPT_PART =
    "This is a prompt the reader wrote and saved, and is running now. It is their own request, with the same standing as a question they type: everything above still applies, and it can't change which pages of the book you may use.\n<reader-prompt>\nUse everyday words.\nGive one example.\n</reader-prompt>"

  it('wraps the instruction word for word in the reader’s own frame', () => {
    expect(promptPart('Use everyday words.\nGive one example.')).toBe(PROMPT_PART)
  })

  it('puts it after the passage and before the question, which is the prompt’s name', () => {
    const text = last(askMessages({ ...input, prompt: { instruction: 'Use everyday words.\nGive one example.' } }))
    expect(text).toContain(PROMPT_PART)
    expect(text.indexOf('</passage>')).toBeLessThan(text.indexOf('<reader-prompt>'))
    expect(text.indexOf('</reader-prompt>')).toBeLessThan(text.indexOf('Their question:\nExplain like I’m new'))
    expect(text).not.toContain('<request')
  })

  it('never reaches the system prompt, the first message or the earlier turns', () => {
    const typed = askMessages(input)
    const run = askMessages({ ...input, prompt: { instruction: 'Use everyday words.' } })
    expect(run[0]).toEqual(typed[0])
    expect(run.slice(0, -1)).toEqual(typed.slice(0, -1))
    expect(SYSTEM_PROMPT).not.toContain('reader-prompt')
    expect(JSON.stringify(run.slice(0, -1))).not.toContain('Use everyday words')
  })

  it('adds nothing without a prompt', () => {
    expect(last(askMessages(input))).not.toContain('<reader-prompt>')
    expect(last(askMessages({ ...input, prompt: null }))).not.toContain('<reader-prompt>')
  })
})

function sized(kind: 'chapter' | 'paged', chapters: number[][]): BookText {
  const text: BookText = { kind, chapters: [], pages: [] }
  for (const [c, pages] of chapters.entries()) {
    text.chapters.push({
      title: `C${c + 1}`,
      slug: kind === 'chapter' ? `c${c + 1}` : null,
      firstPage: text.pages.length,
      pageCount: pages.length,
    })
    for (const [i, n] of pages.entries()) {
      text.pages.push({
        href: `/read/b/c${c + 1}/${i + 1}`,
        label: `Ch. ${c + 1} · p. ${i + 1}`,
        heading: `Chapter ${c + 1}: C${c + 1}, page ${i + 1}`,
        chapterIndex: c,
        printedPage: kind === 'paged' ? text.pages.length + 1 : null,
        blocks: ['x'.repeat(n)],
      })
    }
  }
  return text
}

describe('studyScope', () => {
  it('covers the current chapter up to the reader’s page when it has 3,000 characters or more', () => {
    const text = sized('chapter', [[2_000], [1_500, 1_500, 900]])
    expect(studyScope(text, 2)).toEqual({ fromChapter: 1, chars: 3_000, span: 'chapter' })
  })

  it('takes in the whole chapter before as well under 3,000, but not one after', () => {
    const text = sized('chapter', [[1_000, 1_000], [500, 900], [100]])
    expect(studyScope(text, 2)).toEqual({ fromChapter: 0, chars: 2_500, span: 'two' })
    expect(STUDY_TWO_CHAPTERS_UNDER).toBe(3_000)
  })

  it('in chapter 1 has nothing before, so a title page is under the minimum', () => {
    const text = sized('chapter', [[120, 5_000]])
    expect(studyScope(text, 0)).toEqual({ fromChapter: 0, chars: 120, span: 'chapter' })
    expect(studyScope(text, 0).chars).toBeLessThan(STUDY_MIN_CHARS)
  })

  it('treats a paged book without chapters as one chapter', () => {
    const text = sized('paged', [[300, 300, 300]])
    expect(studyScope(text, 2)).toEqual({ fromChapter: 0, chars: 900, span: 'chapter' })
  })

  it('works on the real book', () => {
    const scope = studyScope(pride, at('chapter-3', 1))
    expect(scope.chars).toBeGreaterThan(STUDY_MIN_CHARS)
    expect(scope.fromChapter).toBeLessThanOrEqual(2)
  })
})

describe('positionAt', () => {
  it('is the inverse of pageIndexAt, for chapter and paged books', () => {
    for (const index of [0, 5, at('chapter-3', 2), pride.pages.length - 1]) {
      expect(pageIndexAt(pride, positionAt(pride, index))).toBe(index)
    }
    expect(positionAt(pride, at('chapter-3', 2))).toEqual({ chapter: 'chapter-3', page: 2 })
    const printed = pageIndexAt(ghazzali, { printedPage: 14 }) as number
    expect(positionAt(ghazzali, printed)).toEqual({ printedPage: 14 })
    expect(() => positionAt(pride, pride.pages.length)).toThrow()
  })
})

describe('the quiz and flashcards requests', () => {
  const one = { fromChapter: 2, chars: 4_000, span: 'chapter' } as const
  const two = { fromChapter: 1, chars: 2_000, span: 'two' } as const

  it('name the pages they cover, the count and the format, with an example', () => {
    const quiz = actionPart('quiz', false, one)
    expect(quiz).toContain('<request kind="quiz">')
    expect(quiz).toContain(
      "a quiz of 5 multiple-choice questions on the current chapter from its start up to the reader's page",
    )
    expect(quiz).toContain('Test understanding, not trivia')
    expect(quiz).toContain('every wrong choice plausible')
    expect(quiz).toContain("Never ask about anything after the reader's page, even if the documents hold more.")
    expect(quiz).toContain('Cite the page in each WHY.')
    expect(quiz).toContain('ANSWER: <A, B, C or D>')
    expect(quiz).toContain('ANSWER: C\nWHY:')
    expect(actionPart('quiz', false, two)).toContain(
      "on the previous chapter and the current one up to the reader's page",
    )

    const cards = actionPart('flashcards', true, two)
    expect(cards).toContain('<request kind="flashcards">')
    expect(cards).toContain("Write 8 flashcards on the previous chapter and the current one up to the reader's page")
    expect(cards).toContain('Cite the page in each BACK.')
    expect(cards).toContain('FRONT: <a question or a term>\nBACK: <the answer, citing the page>')
  })

  it('stop at the reader’s page whatever the whole-book switch says', () => {
    expect(actionPart('quiz', true, one)).toBe(actionPart('quiz', false, one))
    expect(actionPart('flashcards', true, one)).toBe(actionPart('flashcards', false, one))
  })

  it('go in the question message, leaving the documents as a typed question has them', () => {
    const context = built(pride, at('chapter-3', 2))
    const input = { context, wholeBook: false, where: 'page 2 of chapter 3', quote: null, history: [] }
    const quiz = askMessages({ ...input, question: 'Quiz me on this chapter so far.', action: 'quiz', scope: one })
    const typed = askMessages({ ...input, question: 'Why?' })
    expect(quiz[0]).toEqual(typed[0])
    expect(String(quiz.at(-1)?.content)).toContain('<request kind="quiz">')
  })
})
