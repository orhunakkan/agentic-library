import type { DraftBook, SourceCover } from './blocks.ts'
import { cleanDescription, yearFrom } from './details.ts'
import { type ChapterLevel, chaptersOf, languageTag, titleFromFileName } from './detect.ts'
import { type HtmlItem, parseHtml, walkHtml } from './html.ts'
import { sniffImage } from './image.ts'
import { normalizeIsbn } from './isbn.ts'
import { MB, PUBLISHER_MAX } from './limits.ts'
import { decodePath, dirname, joinPath } from './path.ts'
import { PicturePool, pictureSources, type ReadEntry } from './pictures.ts'
import { openZip, type ZipEntry, type ZipOptions } from './zip.ts'

export interface EpubOptions {
  chapterHeading?: 'h1' | 'h2' | 'h3'
  skipChapters?: string[]
  numberedChapters?: boolean
  fileName?: string
  zip?: ZipOptions
}

export interface EpubBook extends DraftBook {
  chapterLevel: ChapterLevel | null
}

export class EpubError extends Error {
  name = 'EpubError'
}

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new EpubError(`missing ${what}`)
  return value
}

const utf8 = new TextDecoder('utf-8')

const MAX_EPUB_COVER_BYTES = 10 * MB

type Opf = ReturnType<typeof parseHtml>

function coverHref(opf: Opf): string | null {
  const items = opf.querySelectorAll('manifest item')
  const byProperty = items.find((i) => (i.getAttribute('properties') ?? '').split(/\s+/).includes('cover-image'))
  if (byProperty) return byProperty.getAttribute('href') ?? null
  const id = opf.querySelectorAll('metadata meta').find((m) => m.getAttribute('name') === 'cover')
  const named = id && items.find((i) => i.getAttribute('id') === id.getAttribute('content'))
  return named?.getAttribute('href') ?? null
}

export async function readEpub(file: Uint8Array, options: EpubOptions = {}): Promise<EpubBook> {
  const zip = openZip(file, options.zip)
  const find = (path: string): ZipEntry | undefined => zip.get(path) ?? zip.get(decodePath(path))
  const entry = (path: string): ZipEntry => must(find(path), `${path} in the EPUB`)
  const text = async (path: string) => utf8.decode(await entry(path).read())

  const container = parseHtml(await text('META-INF/container.xml'))
  const opfPath = must(container.querySelector('rootfile')?.getAttribute('full-path'), 'OPF path')
  const opf = parseHtml(await text(opfPath))
  const hrefs = new Map(
    opf.querySelectorAll('manifest item').map((i) => [i.getAttribute('id'), i.getAttribute('href')]),
  )
  const spine = opf
    .querySelectorAll('spine itemref')
    .map((ref) => must(hrefs.get(ref.getAttribute('idref')), `spine item ${ref.getAttribute('idref')}`))

  const items: HtmlItem[] = []
  const pool = new PicturePool()
  const readEntry: ReadEntry = async (path) => find(path) ?? null
  for (const href of spine) {
    const path = joinPath(dirname(opfPath), href)
    const body = must(parseHtml(await text(path)).querySelector('body'), `<body> in ${href}`)
    await pool.load(pictureSources(body), dirname(path), readEntry)
    walkHtml(body, items, { pictures: pool.lookup(dirname(path)) })
  }

  const dc = (name: string) => opf.getElementsByTagName(`dc:${name}`)[0]?.text.replace(/\s+/g, ' ').trim() || null
  const title = dc('title') ?? titleFromFileName(options.fileName ?? 'Untitled')

  const isbn =
    opf
      .getElementsByTagName('dc:identifier')
      .map((i) => normalizeIsbn(i.text))
      .find(Boolean) ?? null
  const details = {
    description: cleanDescription(opf.getElementsByTagName('dc:description')[0]?.innerHTML),
    isbn,
    publisher: dc('publisher')?.slice(0, PUBLISHER_MAX) ?? null,
    publishedYear: yearFrom(dc('date')),
  }

  const href = coverHref(opf)
  const cover = await epubCover(href ? find(joinPath(dirname(opfPath), href)) : undefined)

  const level = options.chapterHeading ? (Number(options.chapterHeading.slice(1)) as ChapterLevel) : undefined
  const { chapters, level: chapterLevel } = chaptersOf(items, title, level)
  const skip = new Set(options.skipChapters ?? [])
  const kept = chapters.filter((c) => !skip.has(c.title))
  return {
    title,
    author: dc('creator') ?? '',
    language: languageTag(dc('language')) ?? 'en',
    details,
    cover,
    chapters: options.numberedChapters ? kept.map((c) => ({ ...c, title: numberedTitle(c.title) })) : kept,
    pictures: pool.pictures,
    chapterLevel,
  }
}

async function epubCover(entry: ZipEntry | undefined): Promise<SourceCover | null> {
  if (!entry || entry.size > MAX_EPUB_COVER_BYTES) return null
  const bytes = await entry.read().catch(() => null)
  const info = bytes && sniffImage(bytes)
  return bytes && info ? { bytes, info, from: 'epub' } : null
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }

export function chapterNumber(title: string): number | null {
  const bare = title.trim().replace(/\.$/, '')
  if (/^\d{1,4}$/.test(bare)) return Number(bare) || null
  if (!bare || !/^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(bare)) return null
  const digits = [...bare].map((c) => ROMAN[c] as number)
  return digits.reduce((sum, d, i) => sum + (d < (digits[i + 1] ?? 0) ? -d : d), 0)
}

function numberedTitle(title: string): string {
  const n = chapterNumber(title)
  return n === null ? title : `Chapter ${n}`
}
