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

export const articleUrl = (origin: string, name: keyof typeof PAGES & string) => `${origin}/test-articles/${name}`

export function articlesStub(request: Request): Response {
  const path = new URL(request.url).pathname.replace(/^\/test-articles\//, '')
  const picture = /^pictures\/([\w-]+\.png)$/.exec(path)?.[1]
  if (picture && PICTURES[picture])
    return new Response(PICTURES[picture], { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } })
  const name = PAGES[path]
  if (name)
    return new Response(page(name), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  return new Response('Not found', { status: 404 })
}
