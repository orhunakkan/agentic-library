import { privateBookSlug } from '../content/book-slug'
import type { BookContent } from '../content/schema'
import { isUuid } from '../uuid'
import { isOfflineSlug } from './book'

const IMG_SRC = /<img\b[^>]*?\ssrc="([^"]*)"/g
const CATALOGUE_PICTURE = /^\/images\/[a-z0-9-]+\/[^/?#]+$/
const PRIVATE_PICTURE = /^\/account\/books\/[0-9a-f-]{36}\/images\/\d+$/

const unescapeAttribute = (value: string) =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

export function pictureUrls(content: BookContent): string[] {
  if (content.kind !== 'chapter') return []
  const urls = new Set<string>()
  for (const chapter of content.chapters)
    for (const html of chapter.pages)
      for (const match of html.matchAll(IMG_SRC)) {
        const src = unescapeAttribute(match[1] ?? '')
        if (CATALOGUE_PICTURE.test(src) || PRIVATE_PICTURE.test(src)) urls.add(src)
      }
  return [...urls]
}

export function bookOfUrl(pathname: string): string | null {
  const own = (slug: string | undefined) => (slug && isOfflineSlug(slug) ? slug : null)
  let m = /^\/offline\/([^/]+)\.json$/.exec(pathname)
  if (m) return own(m[1])
  m = /^\/images\/([^/]+)\/[^/]+$/.exec(pathname)
  if (m) return own(m[1])
  m = /^\/covers\/(.+)\.svg$/.exec(pathname) ?? /^\/covers\/(.+)-[0-9a-f]{8}\.[a-z]+$/.exec(pathname)
  if (m) return own(m[1])
  m = /^\/account\/books\/([0-9a-f-]{36})\//.exec(pathname)
  return m && isUuid(m[1] as string) ? privateBookSlug(m[1] as string) : null
}
