import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import { privateBookId } from '~/shared/content/private-book'
import type { AudioBook, BookContent, BookMeta, Catalog, Collection, Series } from '~/shared/content/schema'
import { rebaseAudioUrl } from './audio-base'

const CONTENT_DIRS = (process.env.CONTENT_DIR ?? 'content').split(delimiter).map((dir) => resolve(dir))

let catalogPromise: Promise<Catalog> | undefined
const bookIndexes = new WeakMap<Catalog, ReadonlyMap<string, BookMeta>>()
const bookCache = new Map<string, Promise<BookContent | null>>()
const audioCache = new Map<string, Promise<AudioBook | null>>()

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function fileNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export function loadCatalog(): Promise<Catalog> {
  catalogPromise ??= (async () => {
    const catalog: Catalog = { collections: [], series: [], books: [] }
    for (const contentDir of CONTENT_DIRS) {
      const dir = join(contentDir, 'catalog')
      const files = (await fileNames(dir)).filter((f) => f.endsWith('.json')).sort()
      for (const file of files) {
        const part = await readJson<{ collection: Collection; series: Series[]; books: BookMeta[] }>(join(dir, file))
        if (!part) continue
        catalog.collections.push(part.collection)
        catalog.series.push(...part.series)
        catalog.books.push(...part.books)
      }
    }
    return catalog
  })()
  return catalogPromise
}

export async function catalogueBooks(): Promise<ReadonlyMap<string, BookMeta>> {
  const catalog = await loadCatalog()
  let index = bookIndexes.get(catalog)
  if (!index) {
    const books = new Map<string, BookMeta>()
    for (const book of catalog.books) if (!books.has(book.slug)) books.set(book.slug, book)
    index = books
    bookIndexes.set(catalog, index)
  }
  return index
}

export async function catalogueBook(slug: string): Promise<BookMeta | undefined> {
  return (await catalogueBooks()).get(slug)
}

async function readContent<T>(...path: string[]): Promise<T | null> {
  for (const dir of CONTENT_DIRS) {
    const found = await readJson<T>(join(dir, ...path))
    if (found) return found
  }
  return null
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function loadBook(slug: string): Promise<BookContent | null> {
  return cachedBySlug(bookCache, slug, () => readContent<BookContent>('books', `${slug}.json`))
}

export function loadAudio(slug: string): Promise<AudioBook | null> {
  return cachedBySlug(audioCache, slug, async () => {
    const base = process.env.AUDIO_BASE
    const audio = await readContent<AudioBook>('audio', `${slug}.json`)
    return audio && base
      ? { ...audio, episodes: audio.episodes.map((e) => ({ ...e, audioUrl: rebaseAudioUrl(e.audioUrl, base) })) }
      : audio
  })
}

export type CatalogCoverImage = NonNullable<BookMeta['coverImage']>

export async function coverFile(slug: string): Promise<{ path: string; meta: CatalogCoverImage } | null> {
  if (!SLUG.test(slug) || privateBookId(slug)) return null
  const meta = (await catalogueBook(slug))?.coverImage
  if (!meta || !/^[a-z0-9-]+\.(jpg|png|webp)$/.test(meta.file)) return null
  for (const dir of CONTENT_DIRS) {
    const path = join(dir, 'covers', meta.file)
    if (existsSync(path)) return { path, meta }
  }
  return null
}

function cachedBySlug<T>(
  cache: Map<string, Promise<T | null>>,
  slug: string,
  load: () => Promise<T | null>,
): Promise<T | null> {
  if (!SLUG.test(slug) || privateBookId(slug)) return Promise.resolve(null)
  let cached = cache.get(slug)
  if (!cached) {
    cached = load()
    cache.set(slug, cached)
  }
  return cached
}

export async function contentImageFile(slug: string, file: string): Promise<string | null> {
  if (!SLUG.test(slug) || privateBookId(slug) || !/^[0-9a-f]{12}\.[a-z]{3,4}$/.test(file)) return null
  for (const dir of CONTENT_DIRS) {
    const path = join(dir, 'images', slug, file)
    if (existsSync(path)) return path
  }
  return null
}
