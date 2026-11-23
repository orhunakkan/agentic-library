import type { BookMeta, Catalog } from '~/shared/content/schema'

const cover = { background: ['#000000', '#111111'], ink: '#ffffff', motif: 'arch' } as const

function book(
  partial: Partial<BookMeta> & Pick<BookMeta, 'slug' | 'title' | 'seriesSlug' | 'order' | 'kind'>,
): BookMeta {
  return {
    id: `id-${partial.slug}`,
    author: 'Author',
    shortDescription: '',
    language: 'en',
    cover: { ...cover, background: [...cover.background] },
    chapterCount: 3,
    source: { name: 'Test', url: 'https://example.com', license: 'PD' },
    ...partial,
  }
}

export const fixtureCatalog: Catalog = {
  collections: [
    { slug: 'classics', title: 'Classics of Wisdom', tagline: '', kind: 'chapter', tone: 'default', order: 1 },
    { slug: 'inner-path', title: 'The Inner Path', tagline: '', kind: 'paged', tone: 'warm', order: 0 },
  ],
  series: [
    { slug: 'walden', title: 'Walden', description: 'Life in the woods.', collectionSlug: 'classics' },
    { slug: 'emerson', title: 'Emerson', description: 'Essays.', collectionSlug: 'classics' },
    { slug: 'inner-path', title: 'The Inner Path', description: 'Sufi classics.', collectionSlug: 'inner-path' },
    { slug: 'stoic-classics', title: 'Stoic Classics', description: 'Stoics.', collectionSlug: 'classics' },
  ],
  books: [
    book({ slug: 'walden', title: 'Walden', seriesSlug: 'walden', order: 1, kind: 'chapter', audioDurationMs: 1000 }),
    book({
      slug: 'representative-men',
      title: 'Representative Men',
      seriesSlug: 'emerson',
      order: 2,
      kind: 'chapter',
      coverImage: {
        file: 'representative-men.jpg',
        type: 'image/jpeg',
        width: 600,
        height: 900,
        hash: `abcdef12${'0'.repeat(56)}`,
      },
    }),
    book({ slug: 'essays', title: 'Essays', seriesSlug: 'emerson', order: 1, kind: 'chapter', audioDurationMs: 5000 }),
    book({
      slug: 'confessions',
      title: 'The Confessions of Al Ghazzali',
      seriesSlug: 'inner-path',
      order: 1,
      kind: 'paged',
      startPage: 7,
      endPage: 40,
    }),
    book({
      slug: 'rumi',
      title: 'The Persian Mystics: Rúmí',
      seriesSlug: 'inner-path',
      order: 2,
      kind: 'paged',
      startPage: 7,
      endPage: 90,
    }),
    book({ slug: 'meditations', title: 'Meditations', seriesSlug: 'stoic-classics', order: 1, kind: 'chapter' }),
  ],
}
