import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportError } from '~/shared/import/draft'
import { OP, PDF_PASSWORD } from '~/shared/import/pdf/extract'
import { CROP_PADDING, cropScale, openPdf, paddedBox } from './pdf-open'

const getDocument = vi.fn()
const workerOptions = { workerSrc: '' }
vi.mock('pdfjs-dist', () => ({ getDocument, GlobalWorkerOptions: workerOptions }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/assets/pdf.worker.min.mjs' }))

const be16 = (n: number) => [n >> 8, n & 0xff]
const be32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
const header = (type: string, width: number, height: number) =>
  type === 'image/png'
    ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii('IHDR'), ...be32(width), ...be32(height)]
    : [0xff, 0xd8, 0xff, 0xc0, ...be16(17), 8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]

const encodings: { width: number; height: number; type: string }[] = []

class FakeCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext() {
    return { fillStyle: '', fillRect: vi.fn() }
  }
  async convertToBlob({ type }: { type: string }) {
    encodings.push({ width: this.width, height: this.height, type })
    return new Blob([new Uint8Array(header(type, this.width, this.height))], { type })
  }
}

interface Spec {
  width?: number
  height?: number
  lines?: string[]
  images?: { x: number; y: number; width: number; height: number }[]
}

const LINE = 'A line of body text long enough to read as a page of a book, with words in it.'

function stubDocument(specs: Spec[], options: { renderFails?: boolean } = {}) {
  const renders: { page: number; scale: number; transform: number[] }[] = []
  const cleanups: number[] = []
  const pageOf = (number: number) => {
    const { width = 420, height = 595, lines = Array(12).fill(LINE), images = [] } = specs[number - 1] ?? {}
    const fnArray: number[] = []
    const argsArray: unknown[] = []
    for (const image of images) {
      fnArray.push(OP.save, OP.transform, OP.paintImageXObject, OP.restore)
      argsArray.push(null, [image.width, 0, 0, image.height, image.x, height - image.y - image.height], ['img'], null)
    }
    return {
      getViewport: ({ scale }: { scale: number }) => ({
        width: width * scale,
        height: height * scale,
        transform: [scale, 0, 0, -scale, 0, height * scale],
      }),
      getOperatorList: async () => ({ fnArray, argsArray }),
      getTextContent: async () => ({
        items: lines.map((str, i) => ({
          str,
          transform: [10, 0, 0, 10, 45, height - 100 - i * 14],
          width: 380,
          fontName: 'f1',
        })),
        styles: {},
      }),
      commonObjs: { get: () => ({ name: 'Body-Regular' }) },
      render: ({ viewport, transform }: { viewport: { width: number }; transform: number[] }) => {
        renders.push({ page: number, scale: viewport.width / width, transform })
        return { promise: options.renderFails ? Promise.reject(new Error('render failed')) : Promise.resolve() }
      },
      cleanup: () => cleanups.push(number),
    }
  }
  const doc = {
    numPages: specs.length,
    getPage: vi.fn(async (n: number) => pageOf(n)),
    getOutline: async () => null,
    getMetadata: async () => ({ info: { Title: 'Lamp Notes' }, metadata: null }),
  }
  const destroy = vi.fn(async () => {})
  getDocument.mockReturnValue({ promise: Promise.resolve(doc), destroy })
  return { renders, cleanups, destroy, doc }
}

const bytes = () => new Uint8Array([0x25, 0x50, 0x44, 0x46])

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  encodings.length = 0
})
afterEach(() => {
  getDocument.mockReset()
})

describe('openPdf', () => {
  it('reads the pages into a draft and crops each region as a PNG picture keyed by page and number', async () => {
    const { renders, destroy } = stubDocument([{ images: [{ x: 60, y: 300, width: 300, height: 200 }] }])
    const progress: unknown[] = []
    const book = await openPdf('lamp-notes.pdf', bytes(), { onProgress: (p) => progress.push(p) })

    expect(workerOptions.workerSrc).toBe('/assets/pdf.worker.min.mjs')
    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({ fontExtraProperties: true }))
    expect(book.draft.title).toBe('Lamp Notes')
    expect(book.draft.details).toEqual({ description: null, isbn: null, publisher: null, publishedYear: null })
    expect(book.draft.cover).toBeNull()
    const blocks = book.draft.chapters.flatMap((c) => c.blocks)
    expect(blocks.filter((b) => b.type === 'image').map((b) => b.type === 'image' && b.image)).toEqual([1])
    const [picture] = book.draft.pictures
    expect(picture).toMatchObject({ key: 'pdf:1:1', type: 'image/png' })
    expect(encodings).toEqual([{ width: 616, height: 416, type: 'image/png' }])
    expect(renders).toEqual([{ page: 1, scale: 2, transform: [1, 0, 0, 1, -112, -592] }])
    expect(progress).toContainEqual({ stage: 'reading', done: 1, total: 1 })
    expect(progress).toContainEqual({ stage: 'drawing', done: 1, total: 1 })
    expect(book.report.pictures).toBe(1)
    expect(destroy).not.toHaveBeenCalled()
    book.close()
    expect(destroy).toHaveBeenCalled()
    await expect(book.reread({})).rejects.toBeInstanceOf(ImportError)
  })

  it('crops only regions it hasn’t cropped before when the reader’s corrections lay the book out again', async () => {
    const { renders } = stubDocument([{ images: [{ x: 60, y: 300, width: 300, height: 200 }] }])
    const book = await openPdf('notes.pdf', bytes())
    const style = book.styles[0]?.key as string
    const again = await book.reread({ styles: { [style]: 'body' }, chapters: 'headings' })
    expect(renders).toHaveLength(1)
    expect(again.overrides).toEqual({ styles: { [style]: 'body' }, chapters: 'headings' })
    expect(again.draft.pictures[0]).toMatchObject({ key: 'pdf:1:1', type: 'image/png' })
  })

  it('takes page 1 as the cover only when its picture covers most of it', async () => {
    stubDocument([{ images: [{ x: 0, y: 0, width: 420, height: 500 }] }])
    const book = await openPdf('cover.pdf', bytes())
    expect(book.draft.cover).toEqual({
      bytes: expect.any(Uint8Array),
      info: { type: 'image/jpeg', width: 840, height: 1190 },
      from: 'pdf',
    })

    stubDocument([{ images: [{ x: 0, y: 0, width: 420, height: 297 }] }])
    expect((await openPdf('half.pdf', bytes())).draft.cover).toBeNull()
  })

  it('leaves out a region that can’t be drawn instead of failing the import', async () => {
    stubDocument([{ images: [{ x: 60, y: 300, width: 300, height: 200 }] }], { renderFails: true })
    const book = await openPdf('notes.pdf', bytes())
    expect(book.draft.pictures).toEqual([{ key: 'pdf:1:1', problem: 'unreadable' }])

    stubDocument([{ images: [{ x: 0, y: 0, width: 420, height: 500 }] }], { renderFails: true })
    expect((await openPdf('cover.pdf', bytes())).draft.cover).toBeNull()
  })

  it('draws on an HTML canvas where there is no OffscreenCanvas', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({ fillStyle: '', fillRect: vi.fn() }),
          toBlob: (resolve: (blob: Blob) => void, type: string) =>
            resolve(new Blob([new Uint8Array(header(type, canvas.width, canvas.height))], { type })),
        }
        return canvas
      },
    })
    stubDocument([{ images: [{ x: 60, y: 300, width: 300, height: 200 }] }])
    const book = await openPdf('notes.pdf', bytes())
    expect(book.draft.pictures[0]).toMatchObject({ key: 'pdf:1:1', type: 'image/png' })
  })

  it('says a password-protected PDF needs its password removed, and frees the task', async () => {
    const destroy = vi.fn(async () => {})
    const refused = Object.assign(new Error('No password given'), { name: 'PasswordException' })
    getDocument.mockReturnValue({ promise: Promise.reject(refused), destroy })
    await expect(openPdf('locked.pdf', bytes())).rejects.toThrow(new ImportError(PDF_PASSWORD))
    expect(destroy).toHaveBeenCalled()
  })

  it('stops between pages when aborted, rejecting with the signal’s reason, and frees the document', async () => {
    const { destroy } = stubDocument([{}, {}, {}])
    const controller = new AbortController()
    const reading = openPdf('long.pdf', bytes(), {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.stage === 'reading' && p.done === 1) controller.abort()
      },
    })
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
    expect(destroy).toHaveBeenCalled()
  })

  it('turns any other failure into the file being unreadable, and an empty book into no text', async () => {
    const { doc } = stubDocument([{}])
    doc.getPage.mockRejectedValueOnce(new Error('bad xref'))
    await expect(openPdf('broken.pdf', bytes())).rejects.toThrow(
      new ImportError('This file couldn’t be read: bad xref.'),
    )

    stubDocument([{ lines: Array(12).fill('word '.repeat(12)), images: [] }])
    const book = await openPdf('notes.pdf', bytes())
    const style = book.styles[0]?.key as string
    await expect(book.reread({ styles: { [style]: 'drop' } })).rejects.toThrow(
      new ImportError('No text was found in this file.'),
    )
  })
})

describe('crop boxes', () => {
  it('pads a region by 4pt, kept on its page', () => {
    expect(paddedBox({ x: 2, y: 10, width: 100, height: 50 }, { width: 420, height: 595 })).toEqual({
      x: 0,
      y: 10 - CROP_PADDING,
      width: 106,
      height: 58,
    })
    expect(paddedBox({ x: 400, y: 580, width: 20, height: 15 }, { width: 420, height: 595 })).toEqual({
      x: 396,
      y: 576,
      width: 24,
      height: 19,
    })
  })

  it('draws at twice the size, capped at 1,600 wide and 4,800 tall', () => {
    expect(cropScale({ x: 0, y: 0, width: 300, height: 200 })).toBe(2)
    expect(cropScale({ x: 0, y: 0, width: 1000, height: 200 })).toBe(1.6)
    expect(cropScale({ x: 0, y: 0, width: 100, height: 3200 })).toBe(1.5)
  })
})
