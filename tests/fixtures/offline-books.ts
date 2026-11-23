import { privateBookSlug } from '../../src/shared/content/book-slug'
import { privateReaderContext } from '../../src/shared/content/private-book'
import type { ChapterBook } from '../../src/shared/content/schema'
import { type OfflineBook, trimCatalog } from '../../src/shared/offline/book'
import { metaFor } from './books'
import { fixtureCatalog } from './catalog'

export const PRIVATE_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
export const PRIVATE_SLUG = privateBookSlug(PRIVATE_ID)

const figure = (src: string) => `<figure><a href="${src}"><img src="${src}" alt="" width="1" height="1"></a></figure>`

export const CATALOGUE_PICTURE = '/images/essays/0123456789ab.png'

export function catalogueCopy(patch: Partial<OfflineBook> = {}): OfflineBook {
  const meta = metaFor('essays')
  const content: ChapterBook = {
    kind: 'chapter',
    slug: 'essays',
    chapters: [
      { id: 'ch_1', slug: 'history', title: 'History', pages: ['<p>h1</p>', `<p>h2</p>${figure(CATALOGUE_PICTURE)}`] },
      { id: 'ch_2', slug: 'self-reliance', title: 'Self-Reliance', pages: ['<p>s1</p>'] },
    ],
  }
  return {
    v: 1,
    slug: 'essays',
    version: '0123456789abcdef',
    title: meta.title,
    author: meta.author,
    owner: null,
    context: { meta, catalog: trimCatalog(fixtureCatalog, meta) },
    content,
    cover: meta.cover,
    speech: {
      slug: 'essays',
      title: meta.title,
      author: meta.author,
      href: '/library/emerson/essays',
      coverUrl: '/covers/essays.svg',
      cover: meta.cover,
      image: null,
      language: 'en',
      chapterTitles: ['History', 'Self-Reliance'],
    },
    pictures: [CATALOGUE_PICTURE],
    bytes: 2048,
    ...patch,
  }
}

export const PRIVATE_PICTURE = `/account/books/${PRIVATE_ID}/images/1`
export const PRIVATE_COVER = `/account/books/${PRIVATE_ID}/cover?v=abababab`

export function privateCopy(owner = 'ada', patch: Partial<OfflineBook> = {}): OfflineBook {
  const context = privateReaderContext({
    id: PRIVATE_ID,
    title: 'Field Notes',
    author: 'Ada',
    language: 'en',
    chapterCount: 2,
    description: null,
    cover: { width: 600, height: 900, sha256: 'ab'.repeat(32), source: 'upload' },
  })
  return {
    v: 1,
    slug: PRIVATE_SLUG,
    version: 'fedcba9876543210',
    title: 'Field Notes',
    author: 'Ada',
    owner,
    context,
    content: {
      kind: 'chapter',
      slug: PRIVATE_SLUG,
      chapters: [
        { id: 'ch_1', slug: 'morning', title: 'Morning', pages: ['<p>dew</p>', figure(PRIVATE_PICTURE)] },
        { id: 'ch_2', slug: 'evening', title: 'Evening', pages: ['<p>dusk</p>'] },
      ],
    },
    cover: context.meta.cover,
    speech: {
      slug: PRIVATE_SLUG,
      title: 'Field Notes',
      author: 'Ada',
      href: `/account/books/${PRIVATE_ID}`,
      coverUrl: PRIVATE_COVER,
      cover: context.meta.cover,
      image: { src: PRIVATE_COVER, width: 600, height: 900 },
      language: 'en',
      chapterTitles: ['Morning', 'Evening'],
    },
    pictures: [PRIVATE_PICTURE],
    bytes: 4096,
    ...patch,
  }
}

export function fileServer(fail: (url: string) => boolean = () => false) {
  const asked: string[] = []
  const fetcher = async (url: string) => {
    asked.push(new URL(url, 'http://localhost').pathname)
    return fail(url) ? new Response('', { status: 503 }) : new Response('x')
  }
  return { asked, fetcher }
}
