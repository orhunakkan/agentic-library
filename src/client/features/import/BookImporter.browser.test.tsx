import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { problem, problemText } from '~/client/features/audiobook-import/audiobook-problems'
import { IMAGE_PROBLEM_TEXT } from '~/client/features/book-details/CoverChooser'
import { mount } from '~/client/testing/mount'
import { MAX_SOURCE_BYTES } from '~/shared/import/limits'
import { PDF_SCANNED } from '~/shared/import/pdf/extract'
import { DEFAULT_LIMITS } from '~/shared/limits/limits'
import coverJpgUrl from '../../../../tests/fixtures/images/cover.jpg?url'
import notAnImageUrl from '../../../../tests/fixtures/images/not-an-image.jpg?url'
import fieldNotesUrl from '../../../../tests/fixtures/imports/field-notes.epub?url'
import figuresUrl from '../../../../tests/fixtures/imports/figures.epub?url'
import gardenDiaryUrl from '../../../../tests/fixtures/imports/garden-diary.md?url'
import pdfPaperUrl from '../../../../tests/fixtures/imports/pdf-paper.pdf?url'
import pdfScannedUrl from '../../../../tests/fixtures/imports/pdf-scanned.pdf?url'
import teamHandbookUrl from '../../../../tests/fixtures/imports/team-handbook.zip?url'
import { BookImporter } from './BookImporter'
import { BAD_ISBN, bookQuotaText, IMPORT_PROBLEM_TEXT, PICTURE_FAILED, SAVE_FAILED } from './import-problems'
import type { CoverRefusal } from './private-book-save'

/**
 * BookImporter reads the file in the browser with the real import pipeline, and only its uploads go over the network.
 * Every request under `/account/` is answered here, as the server would; anything else, such as the fixture files
 * themselves, goes to the real fetch.
 */
const realFetch = globalThis.fetch.bind(globalThis)

type Answer = (path: string, init?: RequestInit) => Response | Promise<Response>

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const BOOK_ID = 'book-1'

/** The server accepting every step of an import. */
const acceptEverything: Answer = (path) => {
  if (path === '/account/books/new') return json(200, { id: BOOK_ID, imageBytesLeft: DEFAULT_LIMITS.userPictureBytes })
  if (path.startsWith(`/account/books/${BOOK_ID}/cover`)) return json(200, { cover: { width: 600, height: 900 } })
  if (/\/images\/\d+$/.test(path)) return json(200, { width: 800, height: 600 })
  if (/\/chapters\/\d+$/.test(path) || path.endsWith('/finish')) return json(200, { ok: true })
  return new Response(null, { status: 303 })
}

let answer: Answer
let fetchSpy: MockInstance<typeof fetch>

const pathOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

beforeEach(() => {
  answer = acceptEverything
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = pathOf(input)
    return path.startsWith('/account/') ? answer(path, init) : realFetch(input, init)
  })
})

/** The requests the importer sent to the server, in order. */
const sent = () =>
  fetchSpy.mock.calls
    .map(([input, init]) => ({ path: pathOf(input), init }))
    .filter((request) => request.path.startsWith('/account/'))

const sentPaths = () => sent().map((request) => request.path)

/** The JSON body of the first request sent to `path`. */
function bodySentTo(path: string): unknown {
  const request = sent().find((candidate) => candidate.path === path)
  return request ? JSON.parse(String(request.init?.body)) : undefined
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function fixture(url: string, name: string, type = '') {
  return new File([await (await realFetch(url)).arrayBuffer()], name, { type })
}

const fieldNotes = () => fixture(fieldNotesUrl, 'field-notes.epub', 'application/epub+zip')
const gardenDiary = () => fixture(gardenDiaryUrl, 'garden-diary.md', 'text/markdown')

function renderImporter(props: Partial<ComponentProps<typeof BookImporter>> = {}) {
  const onImported = vi.fn<(id: string, coverRefusal?: CoverRefusal) => Promise<void>>(async () => {})
  mount(<BookImporter imageBytesUsed={0} limits={DEFAULT_LIMITS} onImported={onImported} {...props} />)
  return onImported
}

/** The file input is visually hidden behind its label, and is a button named by that label to assistive tech. */
const picker = page.getByRole('button', { name: 'Choose a book file' })
const review = page.getByRole('form', { name: 'Review before saving' })
const saveButton = page.getByRole('button', { name: 'Save to my shelf' })
const chooseAnother = page.getByRole('button', { name: 'Choose another file' })
const alert = page.getByRole('alert')
const chapterTitle = (n: number) => page.getByRole('textbox', { name: `Chapter ${n} title` })
const chapterCount = () => page.getByRole('textbox', { name: /^Chapter \d+ title$/ }).elements().length

async function choose(file: File) {
  await userEvent.upload(picker, file)
}

/**
 * Drops files on the drop zone the way a browser does, with a DataTransfer that keeps the very File objects given,
 * so a test can stand in for their size or their reading. The zone is a plain div with no role: only the file input in
 * it is a control, so it is found by its test id.
 */
function drop(...files: File[]) {
  const transfer = new DataTransfer()
  for (const file of files) transfer.items.add(file)
  const zone = page.getByTestId('drop-zone').element()
  zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
}

/** A file whose reading waits until the test lets it finish. */
function slowFile(file: File) {
  const bytes = deferred<ArrayBuffer>()
  const arrayBuffer = vi.spyOn(file, 'arrayBuffer').mockReturnValue(bytes.promise)
  return { bytes, arrayBuffer, finish: async () => bytes.resolve(await new Response(file).arrayBuffer()) }
}

describe('BookImporter', () => {
  describe('choosing and reviewing a book', () => {
    it('offers one picker for books, named and described for assistive tech, before any file is chosen', async () => {
      renderImporter()

      await expect.element(picker).toHaveAttribute('type', 'file')
      await expect.element(picker).toHaveAttribute('accept', '.epub,.pdf,.md,.markdown,.zip')
      await expect
        .element(picker)
        .toHaveAccessibleDescription(/Choose an EPUB, PDF, Markdown file or ZIP of Markdown files, up to 100 MB/)
      await expect.element(picker).toHaveAccessibleDescription(expect.stringContaining(problemText(problem('off'))))
      await expect.element(alert).not.toBeInTheDocument()
      await expect.element(review).not.toBeInTheDocument()
    })

    it('shows that it is reading, then the EPUB’s details and chapters for review', async () => {
      renderImporter()
      const file = await fieldNotes()
      const reading = slowFile(file)
      drop(file)

      const status = page.getByRole('status')
      await expect.element(status).toHaveTextContent('Reading the file…')
      await expect.element(picker).not.toBeInTheDocument()
      /** A second drop while one file is being read is ignored. */
      drop(await gardenDiary())
      await reading.finish()

      await expect.element(review).toBeVisible()
      expect(reading.arrayBuffer).toHaveBeenCalledOnce()
      await expect.element(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Field Notes')
      await expect.element(page.getByRole('textbox', { name: 'Author' })).toHaveValue('Ada Tester')
      await expect.element(page.getByRole('textbox', { name: 'Language' })).toHaveValue('en')
      await expect.element(page.getByRole('textbox', { name: 'ISBN' })).toHaveValue('9780141439518')
      await expect.element(page.getByRole('textbox', { name: 'Publisher' })).toHaveValue('Tester Press')
      await expect.element(page.getByRole('textbox', { name: 'Year' })).toHaveValue('2019')
      await expect.element(page.getByRole('group', { name: 'Chapters (4)' })).toBeVisible()
      await expect.element(chapterTitle(1)).toHaveValue('Getting Started')
      await expect.element(chapterTitle(4)).toHaveValue('Final Words')
      /** Plain text under the cover, saying where the cover came from; it has no role of its own. */
      await expect.element(page.getByText('From the book’s file')).toBeVisible()
      await expect.element(page.getByRole('button', { name: 'Merge chapter 1 into the one before' })).toBeDisabled()
      expect(sent()).toEqual([])
    })

    it.each([
      { kind: 'Markdown file', open: gardenDiary, title: 'Garden Diary', chapters: 3 },
      {
        kind: 'ZIP of Markdown files',
        open: () => fixture(teamHandbookUrl, 'team-handbook.zip', 'application/zip'),
        title: 'Team Handbook',
        chapters: 3,
      },
    ])('reads a $kind into the same review', async ({ open, title, chapters }) => {
      renderImporter()
      await choose(await open())

      await expect.element(page.getByRole('textbox', { name: 'Title' })).toHaveValue(title)
      expect(chapterCount()).toBe(chapters)
    })

    it('previews a chapter as the reader would see it', async () => {
      renderImporter()
      await choose(await fieldNotes())

      const previewButton = page.getByRole('button', { name: 'Preview chapter 2' })
      await previewButton.click()
      await expect.element(previewButton).toHaveAttribute('aria-pressed', 'true')
      const preview = page.getByRole('region', { name: /^Preview: chapter 2, page 1 of \d+$/ })
      await expect.element(preview).toBeVisible()
      await expect.element(preview).toMatchTextContent('Second thoughts arrive.')
      /** The fixture's script and handlers are rendered as nothing, and its escaped tags as text. */
      await expect.element(preview).toMatchTextContent('Safe link text <b>not bold</b>.')
      expect(preview.element().querySelector('script, [onerror]')).toBeNull()

      await previewButton.click()
      await expect.element(preview).not.toBeInTheDocument()
    })

    it('saves the book: starts it, uploads its cover and chapters in order, finishes it, then hands over the id', async () => {
      const finishing = deferred<Response>()
      answer = (path, init) => (path.endsWith('/finish') ? finishing.promise : acceptEverything(path, init))
      const onImported = renderImporter()
      await choose(await fieldNotes())
      await expect.element(page.getByText('From the book’s file')).toBeVisible()

      await saveButton.click()

      await expect.element(page.getByRole('status')).toHaveTextContent('Saving chapter 4 of 4…')
      await expect.element(saveButton).toBeDisabled()
      await expect.element(chooseAnother).toBeDisabled()
      await expect.element(page.getByRole('textbox', { name: 'Title' })).toBeDisabled()
      expect(onImported).not.toHaveBeenCalled()
      finishing.resolve(json(200, { ok: true }))

      await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith(BOOK_ID, undefined))
      expect(sentPaths()).toEqual([
        '/account/books/new',
        `/account/books/${BOOK_ID}/cover?source=epub`,
        `/account/books/${BOOK_ID}/chapters/0`,
        `/account/books/${BOOK_ID}/chapters/1`,
        `/account/books/${BOOK_ID}/chapters/2`,
        `/account/books/${BOOK_ID}/chapters/3`,
        `/account/books/${BOOK_ID}/finish`,
      ])
      expect(bodySentTo('/account/books/new')).toEqual({
        title: 'Field Notes',
        author: 'Ada Tester',
        language: 'en',
        chapterCount: 4,
        description: expect.stringContaining('lighthouse'),
        isbn: '9780141439518',
        publisher: 'Tester Press',
        publishedYear: 2019,
        images: { count: 0, bytes: 0 },
      })
      expect(bodySentTo(`/account/books/${BOOK_ID}/chapters/0`)).toMatchObject({ title: 'Getting Started' })
    })

    it('saves the details and chapters as the reader edited them', async () => {
      const onImported = renderImporter()
      await choose(await fieldNotes())
      await expect.element(page.getByText('From the book’s file')).toBeVisible()

      await page.getByRole('textbox', { name: 'Title' }).fill('Field Notes, Revised')
      await page.getByRole('textbox', { name: 'Author' }).fill('Ada Q. Tester')
      await page.getByRole('textbox', { name: 'Language' }).fill('en-GB')
      await page.getByRole('textbox', { name: 'Publisher' }).fill('Harbour Books')
      await page.getByRole('textbox', { name: 'Year' }).fill('2024')
      const description = page.getByRole('textbox', { name: 'Description' })
      await description.fill('A keeper’s notes.')
      await expect.element(description).toHaveAccessibleDescription('17 of 4,000')
      await chapterTitle(1).fill('Beginnings')
      await page.getByRole('button', { name: 'Merge chapter 3 into the one before' }).click()
      await page.getByRole('button', { name: 'Drop chapter 3' }).click()
      await page.getByRole('button', { name: 'Use the generated cover' }).click()
      await expect.element(page.getByText('Generated from the title')).toBeVisible()
      await expect.element(page.getByRole('group', { name: 'Chapters (2)' })).toBeVisible()

      await saveButton.click()

      await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith(BOOK_ID, undefined))
      expect(sentPaths()).not.toContain(`/account/books/${BOOK_ID}/cover?source=epub`)
      expect(bodySentTo('/account/books/new')).toMatchObject({
        title: 'Field Notes, Revised',
        author: 'Ada Q. Tester',
        language: 'en-GB',
        publisher: 'Harbour Books',
        chapterCount: 2,
        description: 'A keeper’s notes.',
        publishedYear: 2024,
      })
      expect(bodySentTo(`/account/books/${BOOK_ID}/chapters/0`)).toMatchObject({ title: 'Beginnings' })
      expect(bodySentTo(`/account/books/${BOOK_ID}/chapters/1`)).toMatchObject({ title: 'Second Thoughts' })
    })

    it('uploads the book’s pictures, and says which it leaves out and why', async () => {
      const onImported = renderImporter()
      await choose(await fixture(figuresUrl, 'figures.epub', 'application/epub+zip'))

      /** A summary line under the chapters' legend, with no role of its own. */
      await expect.element(page.getByText('3 pictures · 2 left out')).toBeVisible()
      /** A disclosure's summary has no ARIA role to find it by, so it is found by its text. */
      await page.getByText('Why?').click()
      const reasons = page.getByTestId('picture-summary').getByRole('listitem')
      await expect.element(reasons.nth(0)).toHaveTextContent('1 from the web (Folio doesn’t fetch them)')
      await expect.element(reasons.nth(1)).toHaveTextContent('1 couldn’t be read')

      await saveButton.click()

      await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith(BOOK_ID, undefined))
      const pictures = sent().filter((request) => /\/images\/\d+$/.test(request.path))
      expect(pictures.map((request) => request.path).sort()).toEqual([
        `/account/books/${BOOK_ID}/images/1`,
        `/account/books/${BOOK_ID}/images/2`,
        `/account/books/${BOOK_ID}/images/3`,
      ])
      expect(pictures.every((request) => request.init?.body instanceof Blob)).toBe(true)
      expect(bodySentTo('/account/books/new')).toMatchObject({ images: { count: 3 } })
    })

    it('leaves out the pictures that don’t fit the room left in the library', async () => {
      renderImporter({ imageBytesUsed: DEFAULT_LIMITS.userPictureBytes - 1 })
      await choose(await fixture(figuresUrl, 'figures.epub', 'application/epub+zip'))

      await expect.element(page.getByText('0 pictures · 5 left out')).toBeVisible()
      await page.getByText('Why?').click()
      await expect
        .element(page.getByRole('listitem').filter({ hasText: 'past the room left in your library' }))
        .toHaveTextContent('3 past the room left in your library (1 KB of 250 MB)')
    })

    it('keeps the preview on its chapter as chapters before it change, and closes it when its chapter goes', async () => {
      renderImporter()
      await choose(await fieldNotes())
      await page.getByRole('button', { name: 'Preview chapter 3' }).click()
      await expect
        .element(page.getByRole('region', { name: /^Preview: chapter 3,/ }))
        .toMatchTextContent('A Short Interlude')

      await page.getByRole('button', { name: 'Drop chapter 1' }).click()
      const moved = page.getByRole('region', { name: /^Preview: chapter 2,/ })
      await expect.element(moved).toMatchTextContent('A Short Interlude')
      await expect
        .element(page.getByRole('button', { name: 'Preview chapter 2' }))
        .toHaveAttribute('aria-pressed', 'true')

      await page.getByRole('button', { name: 'Drop chapter 3' }).click()
      await expect.element(moved).toMatchTextContent('A Short Interlude')

      await page.getByRole('button', { name: 'Drop chapter 2' }).click()
      await expect.element(page.getByRole('region', { name: /^Preview:/ })).not.toBeInTheDocument()
    })

    it('saves the reader’s own cover image in place of the file’s', async () => {
      const onImported = renderImporter()
      await choose(await gardenDiary())
      /** Plain text under the cover, saying where the cover came from; it has no role of its own. */
      await expect.element(page.getByText('Generated from the title')).toBeVisible()

      await userEvent.upload(
        page.getByRole('button', { name: 'Choose an image…' }),
        await fixture(coverJpgUrl, 'cover.jpg', 'image/jpeg'),
      )

      await expect.element(page.getByText('Your image')).toBeVisible()
      await saveButton.click()
      await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith(BOOK_ID, undefined))
      const cover = sent().find((request) => request.path.includes('/cover'))
      expect(cover?.path).toBe(`/account/books/${BOOK_ID}/cover?source=upload`)
      expect(cover?.init?.body).toBeInstanceOf(Blob)
    })

    it('says when the chosen cover image can’t be read, and keeps the generated cover', async () => {
      renderImporter()
      await choose(await gardenDiary())

      await userEvent.upload(
        page.getByRole('button', { name: 'Choose an image…' }),
        await fixture(notAnImageUrl, 'not-an-image.jpg', 'image/jpeg'),
      )

      await expect.element(alert).toHaveTextContent(IMAGE_PROBLEM_TEXT.unreadable)
      await expect.element(page.getByText('Generated from the title')).toBeVisible()
      await expect.element(page.getByRole('button', { name: 'Use the generated cover' })).not.toBeInTheDocument()
    })

    it('reads a PDF, says how it read it, and reads it again with a correction', async () => {
      renderImporter()
      await choose(await fixture(pdfPaperUrl, 'pdf-paper.pdf', 'application/pdf'))

      const howRead = page.getByRole('region', { name: 'How the PDF was read' })
      await expect.element(howRead).toBeVisible()
      await expect.element(review).toBeVisible()
      expect(chapterCount()).toBe(5)
      await expect.element(page.getByText('2 pictures', { exact: true })).toBeVisible()

      await howRead.getByRole('combobox', { name: 'Read Geist-Bold, 18pt as' }).selectOptions('Leave out')

      await expect.element(howRead).not.toHaveAttribute('aria-busy')
      await expect.element(howRead.getByRole('combobox', { name: 'Read Geist-Bold, 18pt as' })).toHaveValue('drop')
      expect(chapterCount()).toBeGreaterThan(0)
    }, 30_000)
  })

  describe('when the file can’t be used', () => {
    it.each([
      {
        problemName: 'is not a kind it reads',
        file: () => new File(['plain words'], 'notes.txt', { type: 'text/plain' }),
        message: 'Choose an .epub, .pdf, .md or .zip file.',
      },
      {
        problemName: 'is broken',
        file: () => new File(['not a zip at all'], 'broken.epub', { type: 'application/epub+zip' }),
        message: /This file couldn’t be read: .+\./,
      },
      {
        problemName: 'holds no text',
        file: () => new File(['---\ntitle: Empty\n---\n'], 'empty.md', { type: 'text/markdown' }),
        message: 'No text was found in this file.',
      },
      {
        problemName: 'is a scanned PDF',
        file: () => fixture(pdfScannedUrl, 'pdf-scanned.pdf', 'application/pdf'),
        message: PDF_SCANNED,
      },
    ])(
      'says so when the file $problemName, and lets the reader choose again',
      async ({ file, message }) => {
        renderImporter()
        await choose(await file())

        await expect.element(alert).toMatchTextContent(message)
        await expect.element(picker).toBeEnabled()
        await expect
          .element(picker)
          .toHaveAccessibleDescription(typeof message === 'string' ? expect.stringContaining(message) : message)
        await expect.element(review).not.toBeInTheDocument()

        await choose(await gardenDiary())
        await expect.element(review).toBeVisible()
        await expect.element(alert).not.toBeInTheDocument()
      },
      20_000,
    )

    it('marks the drop zone while a file is dragged over it', async () => {
      renderImporter()
      /** The zone is a plain div with no role, so it is found by its test id; the highlight is only a visual cue. */
      const zone = page.getByTestId('drop-zone')

      zone.element().dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }))
      await expect.element(zone).toHaveClass('border-accent')
      zone.element().dispatchEvent(new DragEvent('dragleave', { bubbles: true }))
      await expect.element(zone).not.toHaveClass('border-accent')
    })

    it('refuses a file over 100 MB before reading it', async () => {
      renderImporter()
      const huge = new File(['x'], 'huge.epub', { type: 'application/epub+zip' })
      Object.defineProperty(huge, 'size', { value: MAX_SOURCE_BYTES + 1 })
      const arrayBuffer = vi.spyOn(huge, 'arrayBuffer')
      drop(huge)

      await expect.element(alert).toHaveTextContent('The file is larger than 100 MB.')
      expect(arrayBuffer).not.toHaveBeenCalled()
    })

    it('refuses a new book when the library already holds its limit', async () => {
      renderImporter({ bookCount: DEFAULT_LIMITS.books })
      const file = await fieldNotes()
      const arrayBuffer = vi.spyOn(file, 'arrayBuffer')
      drop(file)

      await expect.element(alert).toHaveTextContent(bookQuotaText(DEFAULT_LIMITS.books))
      expect(arrayBuffer).not.toHaveBeenCalled()
      await expect.element(review).not.toBeInTheDocument()
    })

    it('says audiobooks are off when they are, and that books and audio can’t be picked together', async () => {
      renderImporter()
      drop(new File(['audio'], 'story.m4b', { type: 'audio/mp4' }))
      await expect.element(alert).toHaveTextContent(problemText(problem('off')))

      drop(await gardenDiary(), new File(['audio'], 'track-01.mp3', { type: 'audio/mpeg' }))
      await expect.element(alert).toHaveTextContent(problemText(problem('mixed')))
    })

    it('hands audio to the audiobook importer when audiobooks are on, and comes back with its problem', async () => {
      renderImporter({ audiobooks: true })
      await expect.element(picker).toHaveAttribute('accept', '.epub,.pdf,.md,.markdown,.zip,.m4b,.mp3')
      await expect.element(picker).toHaveAccessibleDescription(/An audiobook is one M4B file/)

      drop(new File(['not really audio'], 'story.m4b', { type: 'audio/mp4' }))

      await expect.element(alert).toHaveTextContent(problemText({ code: 'type', type: null }))
      await expect.element(picker).toBeVisible()
    })
  })

  describe('when saving fails', () => {
    it.each([
      {
        refusal: 'the library is full',
        at: '/account/books/new',
        reply: () => json(409, { error: 'quota', max: 25 }),
        message: bookQuotaText(25),
      },
      {
        refusal: 'too many imports this hour',
        at: '/account/books/new',
        reply: () => json(429, { error: 'rate' }),
        message: IMPORT_PROBLEM_TEXT.rate,
      },
      {
        refusal: 'the reader was signed out',
        at: '/account/books/new',
        reply: () => json(401, { error: 'signed-out' }),
        message: IMPORT_PROBLEM_TEXT['signed-out'],
      },
      {
        refusal: 'the server can’t be reached',
        at: '/account/books/new',
        reply: () => Promise.reject(new TypeError('Failed to fetch')),
        message: SAVE_FAILED,
      },
      {
        refusal: 'a chapter is too long',
        at: `/account/books/${BOOK_ID}/chapters/1`,
        reply: () => json(413, { error: 'request-too-large' }),
        message: IMPORT_PROBLEM_TEXT['request-too-large'],
      },
    ])('says so when $refusal, and keeps the review to try again', async ({ at, reply, message }) => {
      answer = (path, init) => (path === at ? reply() : acceptEverything(path, init))
      const onImported = renderImporter()
      await choose(await gardenDiary())

      await saveButton.click()

      await expect.element(alert).toHaveTextContent(message)
      await expect.element(review).toBeVisible()
      await expect.element(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Garden Diary')
      await expect.element(saveButton).toBeEnabled()
      expect(onImported).not.toHaveBeenCalled()
    })

    it('discards the half-saved book when a step after the start is refused', async () => {
      answer = (path, init) =>
        path.endsWith('/finish') ? json(409, { error: 'incomplete' }) : acceptEverything(path, init)
      renderImporter()
      await choose(await gardenDiary())

      await saveButton.click()

      await expect.element(alert).toHaveTextContent(IMPORT_PROBLEM_TEXT.incomplete)
      const discard = sent().find((request) => request.path === '/account/books')
      expect(discard?.init?.method).toBe('POST')
      expect(String(discard?.init?.body)).toBe(new URLSearchParams({ intent: 'delete', id: BOOK_ID }).toString())
    })

    it('says a picture couldn’t be saved when the server refuses one', async () => {
      answer = (path, init) =>
        path.endsWith('/images/2') ? json(409, { error: 'quota', scope: 'user' }) : acceptEverything(path, init)
      const onImported = renderImporter()
      await choose(await fixture(figuresUrl, 'figures.epub', 'application/epub+zip'))
      await expect.element(page.getByText('3 pictures · 2 left out')).toBeVisible()

      await saveButton.click()

      await expect.element(alert).toHaveTextContent(PICTURE_FAILED)
      expect(onImported).not.toHaveBeenCalled()
    })

    it('still imports the book when only its cover is refused, and says why', async () => {
      answer = (path, init) =>
        path.includes('/cover') ? json(422, { error: 'image', problem: 'small' }) : acceptEverything(path, init)
      const onImported = renderImporter()
      await choose(await fieldNotes())
      await expect.element(page.getByText('From the book’s file')).toBeVisible()

      await saveButton.click()

      await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith(BOOK_ID, 'small'))
    })

    it('marks a bad ISBN and saves nothing until it’s fixed', async () => {
      renderImporter()
      await choose(await gardenDiary())
      const isbn = page.getByRole('textbox', { name: 'ISBN' })

      await isbn.fill('123')

      await expect.element(isbn).toHaveAttribute('aria-invalid', 'true')
      await expect.element(isbn).toHaveAccessibleDescription(BAD_ISBN)
      await saveButton.click()
      await expect.element(alert).toHaveTextContent(BAD_ISBN)
      expect(sent()).toEqual([])
    })

    it('shows when every chapter has been dropped, and saves nothing', async () => {
      renderImporter()
      await choose(await gardenDiary())

      for (const n of [3, 2, 1]) await page.getByRole('button', { name: `Drop chapter ${n}` }).click()

      await expect.element(page.getByRole('group', { name: 'Chapters (0)' })).toBeVisible()
      /** Plain text in the chapters group, with no role of its own. */
      await expect.element(page.getByText('Every chapter has been dropped.')).toBeVisible()
      await expect.element(saveButton).toBeDisabled()
      expect(sent()).toEqual([])

      await chooseAnother.click()
      await expect.element(picker).toBeVisible()
      await expect.element(review).not.toBeInTheDocument()
    })
  })

  describe('by keyboard', () => {
    it('reaches the picker with Tab, and opens it with Enter or Space', async () => {
      renderImporter()
      const opened = vi.fn()
      picker.element().addEventListener('click', opened)

      await userEvent.tab()
      await expect.element(picker).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      await userEvent.keyboard(' ')

      expect(opened).toHaveBeenCalledTimes(2)
    })

    it('keeps focus on the picker after a refusal it gives at once, and describes the picker by it', async () => {
      renderImporter({ bookCount: DEFAULT_LIMITS.books })
      await userEvent.tab()
      await expect.element(picker).toHaveFocus()

      drop(await gardenDiary())

      await expect.element(alert).toBeVisible()
      await expect.element(picker).toHaveFocus()
      await expect
        .element(picker)
        .toHaveAccessibleDescription(expect.stringContaining(bookQuotaText(DEFAULT_LIMITS.books)))
    })

    it('cancels reading a PDF from the keyboard, and ignores the file once it is read', async () => {
      renderImporter()
      const file = await fixture(pdfPaperUrl, 'pdf-paper.pdf', 'application/pdf')
      const reading = slowFile(file)
      drop(file)

      await expect.element(page.getByRole('progressbar', { name: 'Reading the PDF' })).toBeVisible()
      const cancel = page.getByRole('button', { name: 'Cancel' })
      await userEvent.tab()
      await expect.element(cancel).toHaveFocus()
      await userEvent.keyboard('{Enter}')

      await expect.element(picker).toBeVisible()
      await reading.finish()
      await choose(await gardenDiary())
      await expect.element(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Garden Diary')
    }, 30_000)

    it('saves with Enter from a details field', async () => {
      const onImported = renderImporter()
      await choose(await gardenDiary())

      await page.getByRole('textbox', { name: 'Author' }).click()
      await userEvent.keyboard('{Enter}')

      await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith(BOOK_ID, undefined))
    })

    it('works the chapter list and the preview from the keyboard', async () => {
      renderImporter()
      await choose(await gardenDiary())
      await chapterTitle(1).click()

      await userEvent.tab()
      const preview = page.getByRole('button', { name: 'Preview chapter 1' })
      await expect.element(preview).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      await expect.element(preview).toHaveAttribute('aria-pressed', 'true')
      await expect.element(page.getByRole('region', { name: /^Preview: chapter 1, page 1 of/ })).toBeVisible()

      /** The Merge button of chapter 1 is disabled, so Tab skips it. */
      await userEvent.tab()
      await expect.element(page.getByRole('button', { name: 'Drop chapter 1' })).toHaveFocus()
      await userEvent.tab()
      await expect.element(chapterTitle(2)).toHaveFocus()
      await userEvent.tab()
      await userEvent.tab()
      await expect.element(page.getByRole('button', { name: 'Merge chapter 2 into the one before' })).toHaveFocus()
      await userEvent.keyboard(' ')
      expect(chapterCount()).toBe(2)

      saveButton.element().focus()
      await userEvent.tab({ shift: true })
      const close = page.getByRole('button', { name: 'Close preview' })
      await expect.element(close).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      await expect.element(page.getByRole('region', { name: /^Preview:/ })).not.toBeInTheDocument()
    })

    it('pages through a long chapter’s preview with the keyboard', async () => {
      renderImporter()
      await choose(await gardenDiary())
      await page.getByRole('button', { name: 'Merge chapter 3 into the one before' }).click()
      await page.getByRole('button', { name: 'Merge chapter 2 into the one before' }).click()
      await page.getByRole('button', { name: 'Preview chapter 1' }).click()
      const previewRegion = page.getByRole('region', { name: /^Preview: chapter 1, page 1 of [2-9]$/ })
      await expect.element(previewRegion).toBeVisible()

      saveButton.element().focus()
      await userEvent.tab({ shift: true })
      await userEvent.tab({ shift: true })
      await expect.element(page.getByRole('button', { name: 'Next page' })).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      await expect.element(page.getByRole('region', { name: /^Preview: chapter 1, page 2 of \d+$/ })).toBeVisible()
      await userEvent.tab({ shift: true })
      await expect.element(page.getByRole('button', { name: 'Previous page' })).toHaveFocus()
      await userEvent.keyboard(' ')
      await expect.element(page.getByRole('region', { name: /^Preview: chapter 1, page 1 of \d+$/ })).toBeVisible()
    })

    it('opens the list of left-out pictures with the keyboard', async () => {
      renderImporter()
      await choose(await fixture(figuresUrl, 'figures.epub', 'application/epub+zip'))
      await expect.element(page.getByText('3 pictures · 2 left out')).toBeVisible()
      const why = page.getByText('Why?')

      why.element().focus()
      await expect.element(why).toHaveFocus()
      await userEvent.keyboard('{Enter}')

      expect(why.element().closest('details')?.open).toBe(true)
    })

    it('closes the read-again warning with Escape and keeps the reader’s chapter edits', async () => {
      renderImporter()
      await choose(await fixture(pdfPaperUrl, 'pdf-paper.pdf', 'application/pdf'))
      const howRead = page.getByRole('region', { name: 'How the PDF was read' })
      await expect.element(howRead).toBeVisible()
      await page.getByRole('button', { name: 'Drop chapter 5' }).click()
      expect(chapterCount()).toBe(4)

      await howRead.getByRole('combobox', { name: 'Read Geist-Bold, 18pt as' }).selectOptions('Leave out')
      const warning = page.getByRole('dialog', { name: 'Reading the PDF again undoes your chapter changes.' })
      await expect.element(warning).toBeVisible()
      await userEvent.keyboard('{Escape}')

      await expect.element(warning).not.toBeInTheDocument()
      expect(chapterCount()).toBe(4)

      await howRead.getByRole('combobox', { name: 'Read Geist-Bold, 18pt as' }).selectOptions('Leave out')
      await expect.element(warning).toBeVisible()
      await warning.getByRole('button', { name: 'Read again' }).click()
      await expect.element(howRead.getByRole('combobox', { name: 'Read Geist-Bold, 18pt as' })).toHaveValue('drop')
      await expect.element(howRead).not.toHaveAttribute('aria-busy')
    }, 30_000)

    it('leaves the review in place when Escape is pressed in it', async () => {
      renderImporter()
      await choose(await gardenDiary())
      await page.getByRole('textbox', { name: 'Title' }).click()

      await userEvent.keyboard('{Escape}')

      await expect.element(review).toBeVisible()
      await expect.element(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Garden Diary')
    })
  })
})
