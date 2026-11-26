import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  BookMeta,
  ChapterBook,
  ChapterBookChapter,
  Collection,
  Series,
} from '../../../src/shared/content/schema.ts'
import type { SourceCover } from '../../../src/shared/import/blocks.ts'
import { type PictureState, planPictures } from '../../../src/shared/import/draft.ts'
import { type EpubBook, readEpub } from '../../../src/shared/import/epub.ts'
import { type ImageInfo, sniffImage } from '../../../src/shared/import/image.ts'
import {
  IMAGE_MIN_SIDE,
  KB,
  MAX_CATALOG_COVER_BYTES,
  MAX_CATALOG_IMAGE_BYTES,
} from '../../../src/shared/import/limits.ts'
import { paginate } from '../../../src/shared/import/paginate.ts'
import { type RenderContext, renderBlocks } from '../../../src/shared/import/render.ts'
import { slugify, uniqueSlug } from '../../../src/shared/import/slug.ts'
import { BOOKS, type BookDef, COLLECTION, SERIES, type SeriesDef } from './config.ts'
import { readPdf } from './pdf.ts'
import type { RenderedChapter } from './types.ts'
import { must } from './util.ts'

const ROOT = resolve(import.meta.dirname, '../../..')
const CACHE = join(ROOT, '.cache/ingest/files')
const CONTENT = join(ROOT, 'content')

interface CatalogFile {
  collection: Collection
  series: Series[]
  books: BookMeta[]
}

function uuidFrom(name: string): string {
  const hex = createHash('sha1').update(`agentic-library:${name}`).digest('hex')
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16)
  const s = `${hex.slice(0, 12)}5${hex.slice(13, 16)}${variant}${hex.slice(17, 32)}`
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`
}

async function sourceFile(def: BookDef, sourceDir: string): Promise<Buffer> {
  const path = join(sourceDir, def.file)
  if (!existsSync(path)) {
    if (!def.download) throw new Error(`${path} is missing and ${def.slug} has no download link`)
    console.log(`  downloading ${def.download} …`)
    const res = await fetch(def.download)
    if (!res.ok) throw new Error(`${def.download}: HTTP ${res.status}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    const magic = def.reader.format === 'epub' ? 'PK' : '%PDF'
    if (bytes.subarray(0, magic.length).toString('latin1') !== magic)
      throw new Error(`${def.download} did not answer with the ${def.reader.format.toUpperCase()} file`)
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(path, bytes)
  }
  return readFileSync(path)
}

async function readChapters(
  def: BookDef,
  file: Buffer,
): Promise<{ chapters: RenderedChapter[]; cover: SourceCover | null; pictures: CatalogPicture[] }> {
  if (def.reader.format === 'pdf')
    return { chapters: await readPdf(file, def.reader.options, def.title), cover: null, pictures: [] }
  const book = await readEpub(file, def.reader.options)
  console.log(book.chapterLevel ? `  chapters start at h${book.chapterLevel}` : '  one chapter: no heading level fits')
  const { chapters, pictures } = catalogPictures(def, book)
  return { chapters, cover: def.coverImage === false ? null : book.cover, pictures }
}

interface CatalogPicture {
  file: string
  bytes: Uint8Array
  info: ImageInfo
}

const PICTURE_EXTENSIONS: Record<ImageInfo['type'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function catalogPictures(def: BookDef, book: EpubBook): { chapters: RenderedChapter[]; pictures: CatalogPicture[] } {
  const drop = new Set(def.dropImages ?? [])
  const checked = new Map<number, CatalogPicture>()
  const state = (pictureNumber: number): PictureState => {
    const picture = book.pictures[pictureNumber - 1]
    if (!picture || drop.has(picture.key)) return { ok: false, problem: 'missing' }
    const fix = `; fix it in the EPUB or add "${picture.key}" to the book's dropImages`
    if ('problem' in picture) throw new Error(`${def.slug}: the picture ${picture.key} is ${picture.problem}${fix}`)
    const info = sniffImage(picture.bytes)
    if (!info)
      throw new Error(`${def.slug}: the picture ${picture.key} is ${picture.type}; use JPEG, PNG, WebP or GIF${fix}`)
    if (picture.bytes.length > MAX_CATALOG_IMAGE_BYTES)
      throw new Error(
        `${def.slug}: the picture ${picture.key} is ${Math.round(picture.bytes.length / KB)} KB, over 1 MB${fix}`,
      )
    if (info.width < IMAGE_MIN_SIDE || info.height < IMAGE_MIN_SIDE) return { ok: false, problem: 'small' }
    const hash = createHash('sha256').update(picture.bytes).digest('hex')
    checked.set(pictureNumber, {
      file: `${hash.slice(0, 12)}.${PICTURE_EXTENSIONS[info.type]}`,
      bytes: picture.bytes,
      info,
    })
    return { ok: true, bytes: picture.bytes.length, width: info.width, height: info.height }
  }
  const plan = planPictures(book.chapters, state, { count: Infinity, bytes: Infinity, userBytesLeft: Infinity })
  const pictures = plan.uploads.map((n) => checked.get(n) as CatalogPicture)
  const context: RenderContext = {
    imageSrc: (n) => `/images/${def.slug}/${pictures[n - 1]?.file}`,
    imageSize: (n) => {
      const picture = pictures[n - 1]
      return picture ? { width: picture.info.width, height: picture.info.height } : null
    },
  }
  return {
    chapters: plan.chapters.map((c) => ({ title: c.title, blocks: renderBlocks(c.blocks, context) })),
    pictures,
  }
}

function writePictures(slug: string, pictures: readonly CatalogPicture[], contentDir: string): void {
  const dir = join(contentDir, 'images', slug)
  const keep = new Set(pictures.map((p) => p.file))
  if (existsSync(dir))
    for (const file of readdirSync(dir)) if (!keep.has(file)) rmSync(join(dir, file), { force: true })
  if (!pictures.length) {
    rmSync(dir, { recursive: true, force: true })
    return
  }
  mkdirSync(dir, { recursive: true })
  for (const picture of pictures) writeFileSync(join(dir, picture.file), picture.bytes)
}

async function buildBook(
  def: BookDef,
  sourceDir: string,
): Promise<{ book: ChapterBook; cover: SourceCover | null; pictures: CatalogPicture[] }> {
  const file = await sourceFile(def, sourceDir)
  const { chapters: drafts, cover, pictures } = await readChapters(def, file)
  const used = new Set<string>()
  const chapters: ChapterBookChapter[] = drafts.map((draft, i) => ({
    id: `ch_${i + 1}`,
    slug: uniqueSlug(slugify(draft.title) || `chapter-${i + 1}`, used),
    title: draft.title,
    pages: paginate(draft.blocks),
  }))
  return { book: { kind: 'chapter', slug: def.slug, chapters }, cover, pictures }
}

type CoverImage = NonNullable<BookMeta['coverImage']>
const EXTENSIONS: Record<CoverImage['type'], string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const isCatalogType = (type: string): type is CoverImage['type'] => type in EXTENSIONS

function writeCover(slug: string, cover: SourceCover | null, contentDir: string): CoverImage | undefined {
  const dir = join(contentDir, 'covers')
  const type = cover?.info.type
  const catalogType = type && isCatalogType(type) ? type : undefined
  if (cover && !catalogType)
    throw new Error(`${slug}: the cover is ${type}; use JPEG, PNG or WebP, or set coverImage: false`)
  if (cover && cover.bytes.length > MAX_CATALOG_COVER_BYTES)
    throw new Error(
      `${slug}: the cover is ${Math.round(cover.bytes.length / KB)} KB, over 1 MB; shrink it or set coverImage: false`,
    )
  const ext = catalogType && EXTENSIONS[catalogType]
  for (const other of Object.values(EXTENSIONS))
    if (other !== ext) rmSync(join(dir, `${slug}.${other}`), { force: true })
  if (!cover || !catalogType || !ext) return undefined
  mkdirSync(dir, { recursive: true })
  const file = `${slug}.${ext}`
  writeFileSync(join(dir, file), cover.bytes)
  return {
    file,
    type: catalogType,
    width: cover.info.width,
    height: cover.info.height,
    hash: createHash('sha256').update(cover.bytes).digest('hex'),
  }
}

interface ImportedBook {
  book: ChapterBook
  coverImage: CoverImage | undefined
}

/** A book this run leaves as the last run wrote it, with the cover its entry in the previous catalogue named. */
function keptBook(slug: string, bookPath: string, previous: CatalogFile | null): ImportedBook {
  return {
    book: JSON.parse(readFileSync(bookPath, 'utf8')) as ChapterBook,
    coverImage: previous?.books.find((b) => b.slug === slug)?.coverImage,
  }
}

/** Builds a book from its source file, then writes its cover, its pictures and its JSON, saying what it wrote. */
async function rebuildBook(
  def: BookDef,
  sourceDir: string,
  contentDir: string,
  bookPath: string,
): Promise<ImportedBook> {
  console.log(`• ${def.slug}`)
  const { book, cover, pictures } = await buildBook(def, sourceDir)
  const coverImage = writeCover(def.slug, cover, contentDir)
  if (coverImage) console.log(`  cover: ${coverImage.file}, ${coverImage.width}×${coverImage.height}`)
  writePictures(def.slug, pictures, contentDir)
  const count = pictures.length
  if (count) console.log(`  ${count} picture${count === 1 ? '' : 's'} in images/${def.slug}/`)
  writeFileSync(bookPath, JSON.stringify(book))
  const pages = book.chapters.reduce((n, c) => n + c.pages.length, 0)
  console.log(`  ${book.chapters.length} chapters, ${pages} pages`)
  return { book, coverImage }
}

export interface CollectionPlan {
  collection: Omit<Collection, 'tagline'>
  series: SeriesDef[]
  books: BookDef[]
  sourceDir: string
  contentDir: string
}

export async function importCollection(plan: CollectionPlan, only: readonly string[] = []): Promise<void> {
  const { collection, series: allSeries, books, sourceDir, contentDir } = plan
  const catalogPath = join(contentDir, 'catalog', `${collection.slug}.json`)
  if (!books.length) {
    rmSync(catalogPath, { force: true })
    console.log(`no books in ${collection.slug}: no catalogue file`)
    return
  }
  mkdirSync(join(contentDir, 'books'), { recursive: true })
  mkdirSync(join(contentDir, 'catalog'), { recursive: true })

  const previous = existsSync(catalogPath) ? (JSON.parse(readFileSync(catalogPath, 'utf8')) as CatalogFile) : null

  const metas: BookMeta[] = []
  for (const def of books) {
    const bookPath = join(contentDir, 'books', `${def.slug}.json`)
    const keep = only.length && !only.includes(def.slug) && existsSync(bookPath)
    const { book, coverImage } = keep
      ? keptBook(def.slug, bookPath, previous)
      : await rebuildBook(def, sourceDir, contentDir, bookPath)
    const series = must(
      allSeries.find((s) => s.slug === def.seriesSlug),
      `series ${def.seriesSlug}`,
    )
    metas.push({
      id: uuidFrom(`book:${def.slug}`),
      slug: def.slug,
      title: def.title,
      author: def.author,
      seriesSlug: def.seriesSlug,
      order: def.order,
      shortDescription: def.shortDescription,
      language: def.language,
      tagline: def.tagline,
      kind: 'chapter',
      cover: series.cover,
      ...(coverImage ? { coverImage } : {}),
      chapterCount: book.chapters.length,
      source: def.source,
    })
  }

  const catalog: CatalogFile = {
    collection: {
      ...collection,
      tagline: `${allSeries.length} series · ${books.length} book${books.length === 1 ? '' : 's'}`,
    },
    series: allSeries.map(({ cover: _cover, ...s }) => ({ ...s, collectionSlug: collection.slug })),
    books: metas,
  }
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
  console.log(`catalog → ${catalogPath}`)
}

if (import.meta.main) {
  const plan = { collection: COLLECTION, series: SERIES, books: BOOKS, sourceDir: CACHE, contentDir: CONTENT }
  await importCollection(plan, process.argv.slice(2))
}
