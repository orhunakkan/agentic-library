import { describe, expect, it } from 'vitest'
import { pdfMetadata } from '~/shared/import/pdf/metadata.ts'
import type { PdfInfo } from '~/shared/import/pdf/types.ts'
import { bodyLines, HEAD, heading, page, text } from '../../../../support/shared/pdf/test-pages.ts'

const NO_INFO: PdfInfo = { title: null, author: null, xmpTitle: null, xmpCreator: null, language: null }
const titlePage = page(1, [heading('Lanterns at Sea', 80, 24), ...bodyLines(['by Ada Tester'], { y: 120 })])

describe('pdfMetadata', () => {
  it('prefers XMP over the info dictionary', () => {
    const info = {
      ...NO_INFO,
      title: 'Info Title',
      author: 'Info Author',
      xmpTitle: 'XMP Title',
      xmpCreator: 'Ada, Lin',
    }
    expect(pdfMetadata(info, [titlePage], 'book.pdf')).toMatchObject({ title: 'XMP Title', author: 'Ada, Lin' })
  })

  it('takes the info dictionary when there is no XMP', () => {
    const info = { ...NO_INFO, title: 'Info Title', author: 'Info Author' }
    expect(pdfMetadata(info, [titlePage], 'book.pdf')).toMatchObject({ title: 'Info Title', author: 'Info Author' })
  })

  it.each([
    'chapter-one.docx',
    'thesis.tex',
    'Untitled',
    'untitled 3',
    'Microsoft Word - draft final.doc',
    'Microsoft Word - notes',
    'scan.PDF',
  ])('ignores a title that looks like a file name: %s', (title) => {
    expect(pdfMetadata({ ...NO_INFO, title }, [titlePage], 'book.pdf').title).toBe('Lanterns at Sea')
  })

  it('falls back to the largest text on page 1, a wrapped title kept whole', () => {
    const first = page(1, [
      text('A small running line', { y: 30, size: 8 }),
      text('Lanterns at Sea:', { y: 80, size: 24, font: HEAD }),
      text('A Short Study', { y: 110, size: 24.2, font: HEAD }),
      ...bodyLines(['Ada Tester'], { y: 150 }),
    ])
    expect(pdfMetadata(NO_INFO, [first], 'paper.pdf').title).toBe('Lanterns at Sea: A Short Study')
  })

  it('leaves rotated text out of the title', () => {
    const first = page(1, [text('arXiv:2401.00001v1', { size: 30, rotated: true }), heading('The Real Title', 80, 18)])
    expect(pdfMetadata(NO_INFO, [first], 'paper.pdf').title).toBe('The Real Title')
  })

  it('names the book after its file when page 1 has no text', () => {
    expect(pdfMetadata(NO_INFO, [page(1, [])], 'my_great-book.pdf').title).toBe('my great book')
    expect(pdfMetadata(NO_INFO, [], 'notes.pdf').title).toBe('notes')
  })

  it('has no author when the file names none', () => {
    expect(pdfMetadata(NO_INFO, [titlePage], 'book.pdf').author).toBe('')
  })

  it('reads the language through languageTag, else English', () => {
    expect(pdfMetadata({ ...NO_INFO, language: 'pt_BR' }, [], 'a.pdf').language).toBe('pt-BR')
    expect(pdfMetadata({ ...NO_INFO, language: 'not a tag!' }, [], 'a.pdf').language).toBe('en')
    expect(pdfMetadata(NO_INFO, [], 'a.pdf').language).toBe('en')
  })

  it('finds a valid ISBN in the first 8 pages', () => {
    const pages = [
      titlePage,
      page(2, bodyLines(['Copyright 2019 Tester Press', 'ISBN 978-0-14-143951-8', 'Printed in England'])),
    ]
    expect(pdfMetadata(NO_INFO, pages, 'a.pdf').isbn).toBe('9780141439518')
  })

  it('reads an ISBN-10 and Unicode hyphens', () => {
    const pages = [page(1, bodyLines(['ISBN 0‐14‐143951‐3']))]
    expect(pdfMetadata(NO_INFO, pages, 'a.pdf').isbn).toBe('9780141439518')
  })

  it('ignores a number whose check digit is wrong', () => {
    const pages = [page(1, bodyLines(['ISBN 978-0-14-143951-9', 'Call 0123456780 today']))]
    expect(pdfMetadata(NO_INFO, pages, 'a.pdf').isbn).toBeNull()
  })

  it('prefers a labelled ISBN over an earlier unlabelled number that happens to pass', () => {
    const pages = [page(1, bodyLines(['Order number 0141439513', 'ISBN 978-1-4028-9462-6']))]
    expect(pdfMetadata(NO_INFO, pages, 'a.pdf').isbn).toBe('9781402894626')
  })

  it('takes an unlabelled valid ISBN when there is no labelled one', () => {
    expect(pdfMetadata(NO_INFO, [page(1, bodyLines(['9780141439518']))], 'a.pdf').isbn).toBe('9780141439518')
  })

  it('does not look past page 8', () => {
    const pages = Array.from({ length: 9 }, (_, i) =>
      page(i + 1, bodyLines([i === 8 ? 'ISBN 978-0-14-143951-8' : 'Nothing here'])),
    )
    expect(pdfMetadata(NO_INFO, pages, 'a.pdf').isbn).toBeNull()
  })
})
