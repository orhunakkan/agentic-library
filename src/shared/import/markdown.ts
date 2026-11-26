import { Marked } from 'marked'
import type { DraftBook, SourceCover } from './blocks.ts'
import { type BookDetails, cleanDescription, yearFrom } from './details.ts'
import { bookToml, type ChapterLevel, chaptersOf, frontMatter, languageTag, titleFromFileName } from './detect.ts'
import { type HtmlItem, parseHtml, walkHtml } from './html.ts'
import { sniffImage } from './image.ts'
import { normalizeIsbn } from './isbn.ts'
import { MB, PUBLISHER_MAX } from './limits.ts'
import { decodePath, dirname, joinPath } from './path.ts'
import { PicturePool, pictureSources, type ReadEntry } from './pictures.ts'
import { openZip, type ZipEntry, type ZipOptions } from './zip.ts'

export interface MarkdownBook extends DraftBook {
  chapterLevel: ChapterLevel | null
}

export class MarkdownError extends Error {
  name = 'MarkdownError'
}

const marked = new Marked({ gfm: true, async: false })
const utf8 = new TextDecoder('utf-8')
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

const parseMarkdown = (markdown: string) => parseHtml(marked.parse(markdown) as string)

async function zipItems(markdown: string, items: HtmlItem[], pool: PicturePool, base: string, entry: ReadEntry) {
  const root = parseMarkdown(markdown)
  await pool.load(pictureSources(root), base, entry)
  walkHtml(root, items, { pictures: pool.lookup(base), titleAsCaption: true })
}

function onlyH1(items: readonly HtmlItem[]): string | null {
  const h1 = items.filter((i) => i.kind === 'heading' && i.level === 1)
  return h1.length === 1 && h1[0]?.kind === 'heading' && h1[0].title ? h1[0].title : null
}

function detailsFrom(fields: Record<string, string>): BookDetails {
  return {
    description: cleanDescription(fields.description),
    isbn: fields.isbn ? normalizeIsbn(fields.isbn) : null,
    publisher: fields.publisher?.trim().slice(0, PUBLISHER_MAX) || null,
    publishedYear: yearFrom(fields.year ?? fields.date),
  }
}

function book(
  items: HtmlItem[],
  pool: PicturePool,
  fields: Record<string, string>,
  fallbackTitle: string,
  cover: SourceCover | null = null,
): MarkdownBook {
  const title = fields.title?.trim() || onlyH1(items) || fallbackTitle
  const { chapters, level } = chaptersOf(items, title)
  return {
    title,
    author: (fields.author ?? fields.authors ?? '').trim(),
    language: languageTag(fields.language ?? fields.lang) ?? 'en',
    details: detailsFrom(fields),
    cover,
    chapters,
    pictures: pool.pictures,
    chapterLevel: level,
  }
}

export function readMarkdownFile(text: string, fileName: string): MarkdownBook {
  const { fields, body } = frontMatter(text)
  const items: HtmlItem[] = []
  const pool = new PicturePool()
  walkHtml(parseMarkdown(body), items, { pictures: pool.lookup(''), titleAsCaption: true })
  return book(items, pool, fields, titleFromFileName(fileName))
}

const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path)
const COVER_NAMES = ['cover.jpg', 'cover.jpeg', 'cover.png']
const MAX_ZIP_COVER_BYTES = 10 * MB
const isHidden = (path: string) => path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX')
const shallowFirst = (a: string, b: string) => a.split('/').length - b.split('/').length || natural.compare(a, b)

export function summaryOrder(summary: string, summaryPath: string, available: ReadonlySet<string>): string[] {
  const base = dirname(summaryPath)
  const order: string[] = []
  for (const match of summary.matchAll(/\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) {
    const target = decodePath((match[1] ?? '').split('#')[0] ?? '')
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    const path = joinPath(base, target)
    if (available.has(path) && !order.includes(path)) order.push(path)
  }
  return order
}

export async function readMarkdownZip(file: Uint8Array, fileName: string, options?: ZipOptions): Promise<MarkdownBook> {
  const zip = openZip(file, options)
  const paths = [...zip.keys()].filter((p) => !isHidden(p))
  const shallowest = (name: string) =>
    paths.filter((p) => p.split('/').pop()?.toLowerCase() === name).sort(shallowFirst)[0]
  const read = async (path: string) => utf8.decode((await zip.get(path)?.read()) ?? new Uint8Array())

  const summaryPath = shallowest('summary.md')
  const markdown = new Set(paths.filter((p) => isMarkdown(p) && p !== summaryPath))
  const order = summaryPath
    ? summaryOrder(await read(summaryPath), summaryPath, markdown)
    : [...markdown].sort(natural.compare)
  if (!order.length) throw new MarkdownError('The ZIP has no Markdown chapters')

  const tomlPath = shallowest('book.toml')
  let fields = tomlPath ? bookToml(await read(tomlPath)) : {}
  const items: HtmlItem[] = []
  const pool = new PicturePool()
  const entry: ReadEntry = async (path) => (isHidden(path) ? null : (zip.get(path) ?? null))
  for (const [i, path] of order.entries()) {
    const parsed = frontMatter(await read(path))
    if (i === 0 && !Object.keys(fields).length) fields = parsed.fields
    await zipItems(parsed.body, items, pool, dirname(path), entry)
  }

  const cover = await zipCover(zip, paths, [summaryPath, tomlPath])
  return book(items, pool, fields, titleFromFileName(fileName), cover)
}

async function zipCover(
  zip: Map<string, ZipEntry>,
  paths: readonly string[],
  beside: readonly (string | undefined)[],
): Promise<SourceCover | null> {
  const folders = new Set([''])
  for (const path of beside) if (path) folders.add(dirname(path))
  const covers = paths
    .filter((p) => COVER_NAMES.includes(p.split('/').pop()?.toLowerCase() ?? '') && folders.has(dirname(p)))
    .sort(shallowFirst)
  for (const path of covers) {
    const entry = zip.get(path)
    if (!entry || entry.size > MAX_ZIP_COVER_BYTES) continue
    const bytes = await entry.read().catch(() => null)
    const info = bytes && sniffImage(bytes)
    if (bytes && info && (info.type === 'image/jpeg' || info.type === 'image/png')) return { bytes, info, from: 'zip' }
  }
  return null
}
