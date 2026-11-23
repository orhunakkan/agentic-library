import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it, vi } from 'vitest'
import { ImportError } from '../draft.ts'
import { extractPdf, OP, PDF_PASSWORD, PDF_SCANNED, PDF_TOO_LONG, pdfOpenError } from './extract.ts'

interface StubItem {
  str: string
  transform: number[]
  width: number
  fontName: string
}

interface StubPage {
  width?: number
  height?: number
  viewport?: number[]
  items?: StubItem[]
  fonts?: Record<string, string | Error>
  styles?: Record<string, { fontFamily: string }>
  fnArray?: number[]
  argsArray?: unknown[]
}

const item = (str: string, x: number, y: number, size = 10, fontName = 'f1', width = str.length * 5): StubItem => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  fontName,
})

function stubPage(spec: StubPage) {
  const { width = 420, height = 595 } = spec
  const cleanup = vi.fn()
  return {
    cleanup,
    proxy: {
      getViewport: () => ({ width, height, transform: spec.viewport ?? [1, 0, 0, -1, 0, height] }),
      getOperatorList: async () => ({ fnArray: spec.fnArray ?? [], argsArray: spec.argsArray ?? [] }),
      getTextContent: async () => ({ items: spec.items ?? [], styles: spec.styles ?? {} }),
      commonObjs: {
        get: (id: string) => {
          const font = spec.fonts?.[id]
          if (font instanceof Error) throw font
          return font === undefined ? undefined : { name: font }
        },
      },
      cleanup,
    },
  }
}

interface StubDoc {
  pages: StubPage[]
  numPages?: number
  outline?: unknown[] | null | Error
  destinations?: Record<string, unknown[]>
  info?: Record<string, unknown>
  metadata?: Record<string, unknown> | null
  metadataError?: boolean
}

function stubDoc(spec: StubDoc) {
  const pages = spec.pages.map(stubPage)
  const getPage = vi.fn(async (n: number) => {
    const page = pages[n - 1] ?? stubPage({})
    return page.proxy
  })
  const doc = {
    numPages: spec.numPages ?? pages.length,
    getPage,
    getOutline: async () => {
      if (spec.outline instanceof Error) throw spec.outline
      return spec.outline ?? null
    },
    getDestination: async (name: string) => {
      if (name === 'broken') throw new Error('bad destination')
      return spec.destinations?.[name] ?? null
    },
    getPageIndex: async (ref: { num: number }) => ref.num - 100,
    getMetadata: async () => {
      if (spec.metadataError) throw new Error('no metadata')
      const map = spec.metadata
      return { info: spec.info ?? {}, metadata: map ? { get: (k: string) => map[k] ?? null } : null }
    },
  }
  // biome-ignore lint/suspicious/noExplicitAny: a structural stand-in for pdf.js's document proxy
  return { doc: doc as any, pages, getPage }
}

const textPage = (extra: StubPage = {}): StubPage => ({
  items: [
    item(
      'A line of text long enough to count as a real page of a real book, and then some more words after it.',
      50,
      500,
    ),
  ],
  fonts: { f1: 'ABCDEF+Body-Regular' },
  ...extra,
})

describe('extractPdf: text', () => {
  it('flips coordinates to the top left and names fonts from commonObjs', async () => {
    const { doc } = stubDoc({
      pages: [
        {
          items: [
            item('Chapter One', 45, 525, 20, 'f1'),
            item('body text with words in it, more than fifty characters on the page', 45, 495, 10, 'f2'),
            item('   ', 45, 480, 10, 'f2'),
            item('const x = 1', 55, 470, 8.5, 'f3'),
            item('x', 60, 450, 10, 'f4'),
            item('code()', 70, 440, 8.5, 'f5'),
            item('emphasis', 80, 430, 10, 'f6'),
          ],
          fonts: {
            f1: 'ABCDEF+Geist-Bold',
            f2: 'GHIJKL+Source-Serif-4-14pt',
            f3: 'MNOPQR+JetBrainsMono-Regular',
            f4: 'CMMI10',
            f5: 'F5',
            f6: 'Minion-It',
          },
          styles: { f5: { fontFamily: 'monospace' } },
        },
      ],
    })
    const { pages } = await extractPdf(doc)
    const [page] = pages
    expect(page).toMatchObject({ number: 1, width: 420, height: 595, images: [], paths: [] })
    const items = page?.items ?? []
    expect(items.map((i) => i.text)).toEqual([
      'Chapter One',
      'body text with words in it, more than fifty characters on the page',
      'const x = 1',
      'x',
      'code()',
      'emphasis',
    ])
    expect(items[0]).toMatchObject({ x: 45, y: 70, size: 20, font: 'Geist-Bold', bold: true, italic: false })
    expect(items[1]).toMatchObject({ y: 100, font: 'Source-Serif-4-14pt', bold: false, mono: false, rotated: false })
    expect(items[2]).toMatchObject({ font: 'JetBrainsMono-Regular', mono: true, size: 8.5 })
    expect(items[3]).toMatchObject({ font: 'CMMI10', math: true })
    expect(items[4]).toMatchObject({ font: 'F5', mono: true })
    expect(items[5]).toMatchObject({ italic: true })
  })

  it("keeps pdf.js's font id when the font isn't loaded", async () => {
    const { doc } = stubDoc({
      pages: [textPage({ fonts: { f1: new Error('Requesting object that isn’t resolved yet') } })],
    })
    expect((await extractPdf(doc)).pages[0]?.items[0]?.font).toBe('f1')
  })

  it('marks text that is not horizontal as rotated', async () => {
    const { doc } = stubDoc({
      pages: [
        textPage({
          items: [
            ...(textPage().items ?? []),
            { str: 'arXiv:2401.00001', transform: [0, 10, -10, 0, 20, 300], width: 80, fontName: 'f1' },
            { str: 'upside down', transform: [-10, 0, 0, -10, 200, 300], width: 50, fontName: 'f1' },
          ],
        }),
      ],
    })
    const items = (await extractPdf(doc)).pages[0]?.items ?? []
    expect(items.map((i) => i.rotated)).toEqual([false, true, true])
    expect(items[1]?.size).toBe(10)
  })

  it('maps a page whose view does not start at the origin', async () => {
    const { doc } = stubDoc({ pages: [textPage({ height: 500, viewport: [1, 0, 0, -1, -30, 540] })] })
    expect((await extractPdf(doc)).pages[0]?.items[0]).toMatchObject({ x: 20, y: 40 })
  })
})

describe('extractPdf: pictures and paths', () => {
  it('places images and painted paths through the current transform, and skips clipping paths', async () => {
    const { doc } = stubDoc({
      pages: [
        textPage({
          fnArray: [
            OP.save,
            OP.transform,
            OP.paintImageXObject,
            OP.restore,
            OP.constructPath,
            OP.constructPath,
            OP.save,
            OP.transform,
            OP.constructPath,
            OP.restore,
            OP.paintFormXObjectBegin,
            OP.paintInlineImageXObject,
            OP.paintFormXObjectEnd,
            OP.constructPath,
          ],
          argsArray: [
            null,
            [180, 0, 0, 120, 120, 199],
            ['img1', 360, 240],
            null,
            [OP.endPath, [new Float32Array()], new Float32Array([0, 0, 420, 595])],
            [22, [new Float32Array()], new Float32Array([45, 300, 374, 380])],
            null,
            [0.5, 0, 0, 0.5, 100, 100],
            [20, [new Float32Array()], new Float32Array([0, 0, 40, 20])],
            null,
            [
              [2, 0, 0, 2, 10, 10],
              [0, 0, 1, 1],
            ],
            ['inline'],
            null,
            [22, [null], null],
          ],
        }),
      ],
    })
    const [page] = (await extractPdf(doc)).pages
    expect(page?.images).toEqual([
      { x: 120, y: 276, width: 180, height: 120 },
      { x: 10, y: 583, width: 2, height: 2 },
    ])
    expect(page?.paths).toEqual([
      { x: 45, y: 215, width: 329, height: 80 },
      { x: 100, y: 485, width: 20, height: 10 },
    ])
  })
})

describe('extractPdf: outline and metadata', () => {
  it('resolves bookmarks to a page and a y from the top, dropping those that point nowhere', async () => {
    const ref = (page: number) => ({ num: 100 + page - 1, gen: 0 })
    const { doc } = stubDoc({
      pages: [textPage(), textPage(), textPage()],
      outline: [
        {
          title: ' One ',
          dest: [ref(1), { name: 'XYZ' }, 46, 540, 0],
          items: [{ title: 'Section', dest: 'named', items: [] }],
        },
        { title: 'Two', dest: [1, { name: 'FitH' }, 400], items: [] },
        { title: 'Three', dest: [ref(3), { name: 'Fit' }], items: [] },
        {
          title: 'Part without a page',
          dest: null,
          items: [{ title: 'Lifted', dest: [ref(3), { name: 'XYZ' }, 0, null, 0], items: [] }],
        },
        { title: 'Missing name', dest: 'nowhere', items: [] },
        { title: 'Unreadable', dest: 'broken', items: [] },
        { title: 'Past the end', dest: [ref(9), { name: 'XYZ' }, 0, 10, 0], items: [] },
      ],
      destinations: { named: [ref(2), { name: 'FitR' }, 0, 100, 200, 300] },
    })
    const { outline } = await extractPdf(doc)
    expect(outline).toEqual([
      { title: 'One', page: 1, y: 55, children: [{ title: 'Section', page: 2, y: 295, children: [] }] },
      { title: 'Two', page: 2, y: 195, children: [] },
      { title: 'Three', page: 3, y: 0, children: [] },
      { title: 'Lifted', page: 3, y: 0, children: [] },
    ])
  })

  it('has no outline when the PDF has none or it cannot be read', async () => {
    expect((await extractPdf(stubDoc({ pages: [textPage()] }).doc)).outline).toEqual([])
    expect((await extractPdf(stubDoc({ pages: [textPage()], outline: new Error('bad') }).doc)).outline).toEqual([])
  })

  it('reads the info dictionary, XMP and /Lang', async () => {
    const { doc } = stubDoc({
      pages: [textPage()],
      info: { Title: ' Info Title ', Author: '', Language: 'en-GB' },
      metadata: { 'dc:title': 'XMP Title', 'dc:creator': ['Ada Tester', 'Lin Tester'] },
    })
    expect((await extractPdf(doc)).info).toEqual({
      title: 'Info Title',
      author: null,
      xmpTitle: 'XMP Title',
      xmpCreator: 'Ada Tester, Lin Tester',
      language: 'en-GB',
    })
  })

  it('has empty metadata when it cannot be read', async () => {
    const { doc } = stubDoc({ pages: [textPage()], metadataError: true })
    expect((await extractPdf(doc)).info).toEqual({
      title: null,
      author: null,
      xmpTitle: null,
      xmpCreator: null,
      language: null,
    })
  })
})

describe('extractPdf: refusals and progress', () => {
  const scanned: StubPage = { fnArray: [OP.paintImageXObject], argsArray: [['img', 600, 800]] }

  it('refuses a scan', async () => {
    const { doc } = stubDoc({ pages: [scanned, scanned] })
    await expect(extractPdf(doc)).rejects.toThrow(new ImportError(PDF_SCANNED))
  })

  it('decides a long scan after its first 20 drawn pages', async () => {
    const { doc, getPage } = stubDoc({ pages: [{}, ...Array.from({ length: 30 }, () => scanned)] })
    await expect(extractPdf(doc)).rejects.toThrow(PDF_SCANNED)
    expect(getPage).toHaveBeenCalledTimes(21)
  })

  it('reads a scan with a text layer, and a PDF with a few picture pages', async () => {
    const { doc } = stubDoc({ pages: [textPage(), scanned, textPage({ ...scanned, ...textPage() })] })
    expect((await extractPdf(doc)).pages).toHaveLength(3)
  })

  it('refuses more than 2,000 pages before reading any', async () => {
    expect(PDF_TOO_LONG).toBe('This PDF has more than 2,000 pages.')
    const { doc, getPage } = stubDoc({ pages: [], numPages: 2001 })
    await expect(extractPdf(doc)).rejects.toThrow(new ImportError(PDF_TOO_LONG))
    expect(getPage).not.toHaveBeenCalled()
  })

  it('reads only the pages asked for', async () => {
    const pages = Array.from({ length: 5 }, () => textPage())
    const { doc, getPage } = stubDoc({ pages })
    const progress = vi.fn()
    const source = await extractPdf(doc, { pages: { first: 2, last: 9 }, onProgress: progress })
    expect(source.pages.map((p) => p.number)).toEqual([2, 3, 4, 5])
    expect(getPage.mock.calls.map(([n]) => n)).toEqual([2, 3, 4, 5])
    expect(progress.mock.calls).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ])
  })

  it('stops between pages when aborted', async () => {
    const { doc, getPage } = stubDoc({ pages: [textPage(), textPage(), textPage()] })
    const controller = new AbortController()
    const read = extractPdf(doc, { signal: controller.signal, onProgress: () => controller.abort() })
    await expect(read).rejects.toThrow()
    expect(controller.signal.aborted).toBe(true)
    expect(getPage).toHaveBeenCalledTimes(1)
  })

  it('cleans up every page after reading it', async () => {
    const { doc, pages } = stubDoc({ pages: [textPage(), textPage()] })
    await extractPdf(doc)
    for (const page of pages) expect(page.cleanup).toHaveBeenCalledTimes(1)
  })
})

describe('pdfOpenError', () => {
  it('names a password-protected PDF', () => {
    const error = Object.assign(new Error('No password given'), { name: 'PasswordException', code: 1 })
    expect(pdfOpenError(error)).toEqual(new ImportError(PDF_PASSWORD))
    expect(PDF_PASSWORD).toBe(
      'This PDF is protected by a password. Open it in a PDF app, save a copy without the password, and try that.',
    )
  })

  it('passes an ImportError through and words anything else as unreadable', () => {
    const refusal = new ImportError(PDF_TOO_LONG)
    expect(pdfOpenError(refusal)).toBe(refusal)
    expect(pdfOpenError(new Error('Invalid PDF structure')).message).toBe(
      'This file couldn’t be read: Invalid PDF structure.',
    )
    expect(pdfOpenError('broken').message).toBe('This file couldn’t be read: broken.')
  })
})

describe('OP', () => {
  it("matches pdf.js's operator codes", () => {
    for (const [name, code] of Object.entries(OP)) expect([name, code]).toEqual([name, OPS[name as keyof typeof OPS]])
  })
})
