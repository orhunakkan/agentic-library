import { readFile } from 'node:fs/promises'
import { isCatalogueBookSlug } from '~/shared/content/book-slug'
import { catalogueBook, contentImageFile } from './repository'

export interface ContentImageSources {
  isBook(slug: string): Promise<boolean>
  image(slug: string, file: string): Promise<Uint8Array<ArrayBuffer> | null>
}

const defaultSources: ContentImageSources = {
  isBook: async (slug) => (await catalogueBook(slug)) !== undefined,
  image: async (slug, file) => {
    const path = await contentImageFile(slug, file)
    return path ? new Uint8Array(await readFile(path)) : null
  },
}

const FILE = /^[0-9a-f]{12}\.(jpg|png|webp|gif)$/
const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

const notFound = () =>
  new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } })

export async function serveContentImage(
  slug: string,
  file: string,
  sources: ContentImageSources = defaultSources,
): Promise<Response> {
  const match = FILE.exec(file)
  if (!match || !isCatalogueBookSlug(slug) || !(await sources.isBook(slug))) return notFound()
  const bytes = await sources.image(slug, file)
  if (!bytes) return notFound()
  return new Response(bytes, {
    headers: {
      'content-type': TYPES[match[1] as string] as string,
      'content-length': String(bytes.length),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  })
}
