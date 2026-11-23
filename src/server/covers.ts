import { readFile } from 'node:fs/promises'
import { renderCoverSvg } from '~/shared/content/cover'
import { catalogCoverImage } from '~/shared/content/library'
import type { BookMeta } from '~/shared/content/schema'
import { catalogueBook, coverFile } from './repository'

export interface CoverSources {
  book(slug: string): Promise<BookMeta | undefined>
  image(slug: string): Promise<Uint8Array<ArrayBuffer> | null>
}

const defaultSources: CoverSources = {
  book: catalogueBook,
  image: async (slug) => {
    const file = await coverFile(slug)
    return file ? new Uint8Array(await readFile(file.path)) : null
  },
}

const SLUG = /^[a-z0-9-]+$/
const IMAGE = /^([a-z0-9-]+)-([0-9a-f]{8})\.(jpg|png|webp)$/
const SHORT = 'public, max-age=3600'

const notFound = () => new Response('Not found', { status: 404 })
const redirect = (location: string) =>
  new Response(null, { status: 302, headers: { location, 'cache-control': SHORT } })

export async function serveCover(file: string, sources: CoverSources = defaultSources): Promise<Response> {
  if (file.endsWith('.svg')) {
    const slug = file.slice(0, -'.svg'.length)
    const book = SLUG.test(slug) ? await sources.book(slug) : undefined
    if (!book) return notFound()
    return new Response(renderCoverSvg(book), {
      headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=86400' },
    })
  }

  if (SLUG.test(file)) {
    const book = await sources.book(file)
    if (!book) return notFound()
    return redirect(catalogCoverImage(book)?.src ?? `/covers/${file}.svg`)
  }

  const match = IMAGE.exec(file)
  if (!match) return notFound()
  const book = await sources.book(match[1] as string)
  const image = book && catalogCoverImage(book)
  if (!book?.coverImage || !image) return notFound()
  if (image.src !== `/covers/${file}`) return redirect(image.src)
  const bytes = await sources.image(book.slug)
  if (!bytes) return notFound()
  return new Response(bytes, {
    headers: {
      'content-type': book.coverImage.type,
      'content-length': String(bytes.length),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  })
}
