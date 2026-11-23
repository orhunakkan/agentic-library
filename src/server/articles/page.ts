import '@tanstack/react-start/server-only'
import { MAX_PAGE_PICTURES } from '../../shared/articles/contract.ts'
import { parseSrcset } from '../../shared/articles/srcset.ts'
import { parseHtml } from '../../shared/import/html.ts'

const label = (text: string | undefined | null) =>
  text
    ?.trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase() || null

const headerCharset = (contentType: string | null) =>
  label(/;\s*charset\s*=\s*("[^"]*"|[^;\s]+)/i.exec(contentType ?? '')?.[1])

function bomCharset(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  return null
}

function metaCharset(bytes: Uint8Array): string | null {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048))
  const direct = /<meta[^>]+charset\s*=\s*["']?\s*([^"'\s/>;]+)/i.exec(head)
  return label(direct?.[1])
}

function decoderFor(name: string | null): TextDecoder {
  try {
    return new TextDecoder(name ?? 'utf-8')
  } catch {
    return new TextDecoder('utf-8')
  }
}

export function decodePage(bytes: Uint8Array, contentType: string | null): string {
  const name = headerCharset(contentType) ?? bomCharset(bytes) ?? metaCharset(bytes)
  return decoderFor(name).decode(bytes)
}

const ATTRIBUTES = ['src', 'data-src', 'data-original', 'data-lazy-src'] as const
const SET_ATTRIBUTES = ['srcset', 'data-srcset'] as const

export function pictureAddresses(html: string, base: string): string[] {
  const root = parseHtml(html)
  const found = new Set<string>()
  const add = (address: string | undefined) => {
    const text = address?.trim()
    if (!text || found.size >= MAX_PAGE_PICTURES) return
    try {
      const url = new URL(text, base)
      if (url.protocol === 'https:' || url.protocol === 'http:') found.add(url.href)
    } catch {}
  }
  for (const el of root.querySelectorAll('img, source')) {
    for (const name of ATTRIBUTES) add(el.getAttribute(name))
    for (const name of SET_ATTRIBUTES)
      for (const candidate of parseSrcset(el.getAttribute(name) ?? '')) add(candidate.url)
  }
  return [...found]
}
