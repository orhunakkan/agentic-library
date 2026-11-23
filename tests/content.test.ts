import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadAudio, loadBook, loadCatalog } from '~/server/repository'
import { parseBookSlug } from '~/shared/content/book-slug'
import type { AudioBook, BookContent, BookMeta, ChapterBook, PagedBook } from '~/shared/content/schema'
import { sniffImage } from '~/shared/import/image'
import { MAX_CATALOG_COVER_BYTES, MAX_CATALOG_IMAGE_BYTES } from '~/shared/import/limits'
import { RUN_LANGS } from '~/shared/run-code/langs'

const servedFolders = (process.env.CONTENT_DIR ?? 'content').split(delimiter)

const filesIn = (...path: string[]) => {
  const dir = resolve(...path)
  return existsSync(dir) ? readdirSync(dir) : []
}

const catalog = await loadCatalog()
const books = await Promise.all(catalog.books.map(async (meta) => ({ meta, content: await loadBook(meta.slug) })))
const audioFiles = servedFolders.flatMap((dir) => filesIn(dir, 'audio').map((f) => f.replace(/\.json$/, '')))

it('serves the e2e fixture books, so these checks have something to check', () => {
  expect(servedFolders).toContain(join('tests', 'e2e', 'content'))
  expect(catalog.books.map((b) => b.slug)).toContain('pride-and-prejudice')
})

describe('catalog', () => {
  it('has unique slugs and ids', () => {
    const slugs = catalog.books.map((b) => b.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(new Set(catalog.books.map((b) => b.id)).size).toBe(slugs.length)
    expect(new Set(catalog.series.map((s) => s.slug)).size).toBe(catalog.series.length)
  })

  it('names every book with a catalogue book slug, never one shaped like a private book’s', () => {
    for (const { slug } of catalog.books) expect(parseBookSlug(slug), slug).toEqual({ kind: 'catalogue', slug })
    for (const { slug } of catalog.series) expect(parseBookSlug(slug)?.kind, slug).not.toBe('private')
  })

  it('references existing series and collections, with matching kinds', () => {
    for (const book of catalog.books) {
      const series = catalog.series.find((s) => s.slug === book.seriesSlug)
      const collection = catalog.collections.find((c) => c.slug === series?.collectionSlug)
      expect(collection?.kind, book.slug).toBe(book.kind)
    }
  })

  it('has a content file for every book', () => {
    for (const { meta, content } of books) {
      expect(content?.kind, meta.slug).toBe(meta.kind)
      expect(content?.chapters.length, meta.slug).toBe(meta.chapterCount)
    }
  })
})

const paged = books.filter((b): b is { meta: BookMeta; content: PagedBook } => b.content?.kind === 'paged')

describe.each(paged)('paged book $meta.slug', ({ meta, content }) => {
  it('numbers pages contiguously and matches the catalog range', () => {
    expect(content.pages.map((p) => p.pageNumber)).toEqual(
      Array.from({ length: content.endPage - content.startPage + 1 }, (_, i) => content.startPage + i),
    )
    expect([meta.startPage, meta.endPage]).toEqual([content.startPage, content.endPage])
  })

  it('covers every page with exactly one chapter, sub-sections inside their chapter', () => {
    let expected = content.startPage
    for (const chapter of content.chapters) {
      expect(chapter.startPage).toBe(expected)
      expect(chapter.endPage).toBeGreaterThanOrEqual(chapter.startPage)
      for (const child of chapter.children) {
        expect(child.pageNumber).toBeGreaterThanOrEqual(chapter.startPage)
        expect(child.pageNumber).toBeLessThanOrEqual(chapter.endPage)
      }
      expected = chapter.endPage + 1
    }
    expect(expected - 1).toBe(content.endPage)
  })

  it('pairs every footnote reference with a footnote on the same page', () => {
    for (const page of content.pages) {
      const refs = page.blocks.flatMap((b) => b.content.filter((i) => i.type === 'footnoteRef').map((i) => i.refId))
      expect(refs.sort(), `page ${page.pageNumber}`).toEqual(page.footnotes.map((f) => f.id).sort())
    }
  })
})

const ALLOWED_TAG =
  /^(h3|h4|p|blockquote|strong|em|code|sup|sub|br|ul|ol|li|pre|table|thead|tbody|tr|th|td|figure|figcaption|a|img)$/
const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

const chapterBooks = servedFolders.flatMap((dir) => {
  const booksDir = resolve(dir, 'books')
  return filesIn(dir, 'books')
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ dir, content: JSON.parse(readFileSync(join(booksDir, f), 'utf8')) as BookContent }))
    .filter((b): b is { dir: string; content: ChapterBook } => b.content.kind === 'chapter')
})

describe.each(chapterBooks)('chapter book $content.slug', ({ dir, content }) => {
  it('has unique chapter slugs and no empty pages', () => {
    expect(new Set(content.chapters.map((c) => c.slug)).size).toBe(content.chapters.length)
    for (const chapter of content.chapters) {
      expect(chapter.pages.length, chapter.slug).toBeGreaterThan(0)
      for (const html of chapter.pages)
        expect(html.replace(/<(?!img\b)[^>]+>/g, '').trim().length, chapter.slug).toBeGreaterThan(0)
    }
  })

  const IMG = new RegExp(
    `^src="/images/${content.slug}/([0-9a-f]{12})\\.(jpg|png|webp|gif)" alt="[^"<>]*" width="(\\d+)" height="(\\d+)" loading="lazy" decoding="async"$`,
  )
  const LINK = /^href="([^"]+)"( aria-label="View picture")?$/
  const PRE = new RegExp(`^data-lang="(${RUN_LANGS.join('|')})"$`)

  it('uses only the allowed HTML subset (it is injected unescaped)', () => {
    for (const chapter of content.chapters) {
      for (const html of chapter.pages) {
        let link: string | null = null
        for (const [, closing, tag, attrs] of html.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g)) {
          expect(tag, `${chapter.slug}: <${tag}>`).toMatch(ALLOWED_TAG)
          const attributes = (attrs ?? '').trim().replace(/\/$/, '').trim()
          const what = `${chapter.slug}: <${closing}${tag} ${attributes}>`
          if (closing) expect(attributes, what).toBe('')
          else if (tag === 'img') {
            expect(attributes, what).toMatch(IMG)
            expect(link, what).toBe(/^src="([^"]+)"/.exec(attributes)?.[1])
            link = null
          } else if (tag === 'a') {
            expect(attributes, what).toMatch(LINK)
            link = LINK.exec(attributes)?.[1] ?? null
          } else if (tag === 'pre' && attributes) expect(attributes, what).toMatch(PRE)
          else if (attributes) expect(attributes, what).toMatch(/^class="(verse|question)"$/)
        }
      }
    }
  })

  const pictures = content.chapters.flatMap((c) =>
    c.pages.flatMap((html) => [...html.matchAll(/<img ([^>]*)>/g)].map((m) => IMG.exec(m[1] ?? ''))),
  )

  it('has every picture it shows, of the type its name says, its hash, its size and under 1 MB', () => {
    for (const match of pictures) {
      const [, hash, ext, width, height] = match ?? []
      const file = resolve(dir, 'images', content.slug, `${hash}.${ext}`)
      expect(existsSync(file), file).toBe(true)
      const bytes = new Uint8Array(readFileSync(file))
      expect(createHash('sha256').update(bytes).digest('hex').slice(0, 12), file).toBe(hash)
      expect(sniffImage(bytes), file).toEqual({
        type: EXTENSION_TYPES[ext ?? ''],
        width: Number(width),
        height: Number(height),
      })
      expect(bytes.length, file).toBeLessThanOrEqual(MAX_CATALOG_IMAGE_BYTES)
    }
  })
})

describe.each(servedFolders)('pictures in %s', (dir) => {
  it('has no picture file that no page shows', () => {
    const imagesDir = resolve(dir, 'images')
    const shown = new Set(
      chapterBooks
        .filter((b) => b.dir === dir)
        .flatMap(({ content }) =>
          content.chapters.flatMap((c) =>
            c.pages.flatMap((html) => [...html.matchAll(/<img src="\/images\/([^"]+)"/g)].map((m) => m[1])),
          ),
        ),
    )
    const files = existsSync(imagesDir)
      ? readdirSync(imagesDir, { recursive: true, withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => `${e.parentPath.slice(imagesDir.length + 1).replaceAll('\\', '/')}/${e.name}`)
      : []
    expect(files.filter((f) => !shown.has(f))).toEqual([])
  })
})

describe('audiobooks', () => {
  it.each(audioFiles)('%s points at real chapters and matches the catalog duration', async (slug) => {
    const audio = (await loadAudio(slug)) as AudioBook
    const entry = books.find((b) => b.meta.slug === slug)
    expect(entry, slug).toBeDefined()
    const content = entry?.content as BookContent
    const refs = content.kind === 'paged' ? content.chapters.map((c) => c.id) : content.chapters.map((c) => c.slug)
    for (const episode of audio.episodes) {
      if (episode.chapterRef) expect(refs, episode.title).toContain(episode.chapterRef)
      expect(episode.audioUrl).toMatch(/^https:\/\//)
      expect(episode.durationMs).toBeGreaterThan(0)
    }
    expect(audio.episodes.map((e) => e.number)).toEqual(audio.episodes.map((_, i) => i + 1))
    expect(entry?.meta.audioDurationMs).toBe(audio.episodes.reduce((n, e) => n + e.durationMs, 0))
  })

  it('every book that claims audio has an audiobook file', () => {
    for (const book of catalog.books.filter((b) => b.audioDurationMs !== undefined))
      expect(audioFiles).toContain(book.slug)
  })
})

const coverFolders = servedFolders.map((dir) => {
  const catalogDir = resolve(dir, 'catalog')
  const metas = filesIn(dir, 'catalog')
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => (JSON.parse(readFileSync(join(catalogDir, f), 'utf8')) as { books: BookMeta[] }).books)
  return { dir, metas, coversDir: resolve(dir, 'covers'), files: filesIn(dir, 'covers') }
})

describe.each(coverFolders)('covers in $dir', ({ metas, coversDir, files }) => {
  it('has each coverImage’s file, of the type, size and hash the catalogue says, under 1 MB', () => {
    for (const meta of metas.filter((m) => m.coverImage)) {
      const cover = meta.coverImage as NonNullable<BookMeta['coverImage']>
      expect(cover.file, meta.slug).toMatch(new RegExp(`^${meta.slug}.(jpg|png|webp)$`))
      const bytes = new Uint8Array(readFileSync(join(coversDir, cover.file)))
      expect(sniffImage(bytes), meta.slug).toEqual({ type: cover.type, width: cover.width, height: cover.height })
      expect(createHash('sha256').update(bytes).digest('hex'), meta.slug).toBe(cover.hash)
      expect(bytes.length, meta.slug).toBeLessThanOrEqual(MAX_CATALOG_COVER_BYTES)
    }
  })

  it('has no cover file without a book', () => {
    const named = new Set(metas.flatMap((m) => (m.coverImage ? [m.coverImage.file] : [])))
    expect(files.filter((f) => !named.has(f))).toEqual([])
  })
})
