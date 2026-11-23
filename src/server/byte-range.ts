import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (!match[1] && !match[2])) return null
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  return start <= end && start < size ? { start, end } : null
}

export function rangeResponse(request: Request, path: string, size: number, headers: Record<string, string>): Response {
  const head = request.method === 'HEAD'
  const all = { ...headers, 'accept-ranges': 'bytes' }
  const body = (start: number, end: number) =>
    head || size === 0 ? null : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>)
  const rangeHeader = request.headers.get('range')
  if (rangeHeader && !head) {
    const range = parseRange(rangeHeader, size)
    if (!range) return new Response(null, { status: 416, headers: { ...all, 'content-range': `bytes */${size}` } })
    return new Response(body(range.start, range.end), {
      status: 206,
      headers: {
        ...all,
        'content-length': String(range.end - range.start + 1),
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
      },
    })
  }
  return new Response(body(0, size - 1), { headers: { ...all, 'content-length': String(size) } })
}
