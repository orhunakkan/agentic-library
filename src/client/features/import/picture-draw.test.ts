import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_IMAGE_BYTES } from '~/shared/import/limits'
import { drawPicture } from './picture-draw'

const be16 = (n: number) => [n >> 8, n & 0xff]
const be32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))

function header(type: string, width: number, height: number): number[] {
  if (type === 'image/png')
    return [
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...be32(13),
      ...ascii('IHDR'),
      ...be32(width),
      ...be32(height),
    ]
  return [
    0xff,
    0xd8,
    0xff,
    0xc0,
    ...be16(17),
    8,
    ...be16(height),
    ...be16(width),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ]
}

interface Encoding {
  width: number
  height: number
  type: string
  quality: number
}
const encodings: Encoding[] = []
let encoder: (e: Encoding) => { type: string; size: number } | 'throw' | null
const fills: string[] = []

class FakeCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext() {
    return {
      set fillStyle(value: string) {
        fills.push(value)
      },
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    }
  }
  async convertToBlob({ type, quality }: { type: string; quality: number }) {
    const encoding = { width: this.width, height: this.height, type, quality }
    encodings.push(encoding)
    const answer = encoder(encoding)
    if (answer === 'throw') throw new DOMException('tainted', 'SecurityError')
    if (!answer) return null
    const bytes = new Uint8Array(answer.size)
    bytes.set(header(answer.type, this.width, this.height))
    return new Blob([bytes], { type: answer.type })
  }
}

const closed: number[] = []
function decodesAs(width: number | 'fail', height = 0) {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      if (width === 'fail') throw new DOMException('bad', 'InvalidStateError')
      return { width, height, close: () => closed.push(width) }
    }),
  )
}

function svgImages(decodes = true) {
  vi.stubGlobal(
    'Image',
    class {
      src = ''
      decode = () => (decodes ? Promise.resolve() : Promise.reject(new Error('bad svg')))
    },
  )
}

const BYTES = new Uint8Array([1, 2, 3])

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  encoder = ({ type }) => ({ type, size: 1000 })
})
afterEach(() => {
  encodings.length = 0
  closed.length = 0
  fills.length = 0
})

describe('drawPicture', () => {
  it('draws a PNG as a PNG at its own size, without a white fill, and closes the bitmap', async () => {
    decodesAs(800, 400)
    const drawn = await drawPicture(BYTES, 'image/png')
    expect(drawn).toMatchObject({ width: 800, height: 400 })
    expect('blob' in drawn && drawn.blob.type).toBe('image/png')
    expect(encodings).toEqual([{ width: 800, height: 400, type: 'image/png', quality: 0.85 }])
    expect(fills).toEqual([])
    expect(closed).toEqual([800])
  })

  it('draws a photo as a JPEG on white, fitted to 1,600 × 4,800', async () => {
    decodesAs(3200, 2000)
    expect(await drawPicture(BYTES, 'image/webp')).toMatchObject({ width: 1600, height: 1000 })
    expect(encodings[0]).toMatchObject({ type: 'image/jpeg', width: 1600, height: 1000 })
    expect(fills).toEqual(['#ffffff'])
    decodesAs(100, 6000)
    expect(await drawPicture(BYTES, 'image/jpeg')).toMatchObject({ width: 80, height: 4800 })
  })

  it('makes a GIF a PNG, its first frame being what the browser decodes', async () => {
    decodesAs(200, 100)
    const drawn = await drawPicture(BYTES, 'image/gif')
    expect('blob' in drawn && drawn.blob.type).toBe('image/png')
  })

  it('shrinks to 0.75 and then 0.5 of the size until it is under 900 KB', async () => {
    decodesAs(1600, 1200)
    encoder = ({ type, width }) => ({ type, size: width > 800 ? MAX_IMAGE_BYTES + 1 : MAX_IMAGE_BYTES })
    expect(await drawPicture(BYTES, 'image/jpeg')).toMatchObject({ width: 800, height: 600 })
    expect(encodings.map((e) => e.width)).toEqual([1600, 1200, 800])
  })

  it('turns a PNG that never fits into a JPEG on white, at lower qualities', async () => {
    decodesAs(1000, 1000)
    encoder = ({ type, quality }) => ({
      type,
      size: type === 'image/png' || quality > 0.75 ? MAX_IMAGE_BYTES + 1 : 1000,
    })
    const drawn = await drawPicture(BYTES, 'image/png')
    expect(drawn).toMatchObject({ width: 1000, height: 1000 })
    expect('blob' in drawn && drawn.blob.type).toBe('image/jpeg')
    expect(encodings.map((e) => `${e.type} ${e.width} ${e.quality}`)).toEqual([
      'image/png 1000 0.85',
      'image/png 750 0.85',
      'image/png 500 0.85',
      'image/jpeg 1000 0.85',
      'image/jpeg 1000 0.75',
    ])
  })

  it('is too large when nothing fits, and skips sizes under 16px', async () => {
    decodesAs(24, 24)
    encoder = ({ type }) => ({ type, size: MAX_IMAGE_BYTES + 1 })
    expect(await drawPicture(BYTES, 'image/jpeg')).toEqual({ problem: 'large' })
    expect(encodings.map((e) => e.width)).toEqual([24, 18])
  })

  it('refuses what the canvas answers in another type, or can’t read back', async () => {
    decodesAs(400, 300)
    encoder = () => ({ type: 'image/png', size: 1000 })
    expect(await drawPicture(BYTES, 'image/jpeg')).toEqual({ problem: 'large' })
    encoder = () => 'throw'
    expect(await drawPicture(BYTES, 'image/jpeg')).toEqual({ problem: 'unreadable' })
    encoder = () => null
    expect(await drawPicture(BYTES, 'image/png')).toEqual({ problem: 'unreadable' })
  })

  it('leaves out what can’t be decoded, and a spacer', async () => {
    decodesAs('fail')
    expect(await drawPicture(BYTES, 'image/png')).toEqual({ problem: 'unreadable' })
    decodesAs(12, 400)
    expect(await drawPicture(BYTES, 'image/png')).toEqual({ problem: 'small' })
    expect(closed).toEqual([12])
  })

  it('draws an SVG through an image at twice its own size, or 800 × 600 doubled', async () => {
    svgImages()
    const svg = (root: string) => new TextEncoder().encode(root)
    expect(await drawPicture(svg('<svg width="320" height="120"/>'), 'image/svg+xml')).toMatchObject({
      width: 640,
      height: 240,
    })
    expect(encodings[0]?.type).toBe('image/png')
    expect(await drawPicture(svg('<svg/>'), 'image/svg+xml')).toMatchObject({ width: 1600, height: 1200 })
    expect(await drawPicture(svg('<svg width="5" height="5"/>'), 'image/svg+xml')).toEqual({ problem: 'small' })
    svgImages(false)
    expect(await drawPicture(svg('<svg/>'), 'image/svg+xml')).toEqual({ problem: 'unreadable' })
  })

  it('draws on an HTML canvas where there is no OffscreenCanvas', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => new FakeCanvas(1, 1).getContext(),
      toBlob: (done: (blob: Blob | null) => void, type: string) => {
        const bytes = new Uint8Array(1000)
        bytes.set(header(type, canvas.width, canvas.height))
        done(new Blob([bytes], { type }))
      },
    }
    vi.stubGlobal('document', { createElement: () => canvas })
    decodesAs(300, 200)
    expect(await drawPicture(BYTES, 'image/png')).toMatchObject({ width: 300, height: 200 })
  })
})
