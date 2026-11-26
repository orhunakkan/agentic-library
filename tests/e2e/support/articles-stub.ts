import { readFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'

const page = (name: string) => readFileSync(new URL(`./articles/${name}`, import.meta.url))

function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3).fill(Buffer.from(rgb))])
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
  const bytes = new Uint8Array(png.length)
  bytes.set(png)
  return bytes
}

const PICTURES: Record<string, Uint8Array<ArrayBuffer>> = {
  'train-400.png': solidPng(400, 240, [40, 70, 140]),
  'train-800.png': solidPng(800, 480, [40, 70, 140]),
  'map.png': solidPng(600, 400, [60, 130, 80]),
}

const PAGES: Record<string, string> = { news: 'news.html', blog: 'blog.html' }

const WORDS = ['river', 'lantern', 'harbour', 'meadow', 'signal', 'quarry', 'orchard', 'ember', 'valley', 'compass']

/** An article of about 1.35 MB of text: past the 1 MB an article may hold, and inside the 5 MB a page may be. */
function longPage(): string {
  const paragraph = (i: number) =>
    `<p>${Array.from({ length: 120 }, (_, j) => WORDS[(i * 7 + j * 3) % WORDS.length]).join(' ')} ${i}.</p>`
  const paragraphs = Array.from({ length: 1500 }, (_, i) => paragraph(i)).join('\n')
  return `<!doctype html><html lang="en"><head><title>A Very Long Read</title></head><body>
<article><h1>A Very Long Read</h1>${paragraphs}</article></body></html>`
}

const BUILT: Record<string, () => string> = { long: longPage }

export const articleUrl = (origin: string, name: 'news' | 'blog' | 'long') => `${origin}/test-articles/${name}`

export function articlesStub(request: Request): Response {
  const path = new URL(request.url).pathname.replace(/^\/test-articles\//, '')
  const picture = /^pictures\/([\w-]+\.png)$/.exec(path)?.[1]
  if (picture && PICTURES[picture])
    return new Response(PICTURES[picture], { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } })
  const name = PAGES[path]
  const built = BUILT[path]
  if (name || built)
    return new Response(name ? page(name) : built?.(), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  return new Response('Not found', { status: 404 })
}
