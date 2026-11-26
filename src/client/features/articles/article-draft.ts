import { MAX_ARTICLE_PICTURES, MIN_ARTICLE_CHARACTERS, siteOf } from '~/shared/articles/contract'
import { chooseCandidate, parseSrcset } from '~/shared/articles/srcset'
import {
  AUTHOR_MAX,
  type BookBlock,
  type DraftBook,
  LANGUAGE_TAG,
  type ListBlock,
  type Run,
  type SourcePicture,
  TITLE_MAX,
} from '~/shared/import/blocks'
import { cleanDescription, yearFrom } from '~/shared/import/details'
import { finishDraft } from '~/shared/import/draft'
import { type HtmlItem, type PictureLookup, parseHtml, walkHtml } from '~/shared/import/html'
import { PUBLISHER_MAX } from '~/shared/import/limits'

export interface ReadabilityResult {
  title?: string | null
  byline?: string | null
  content?: string | null
  excerpt?: string | null
  siteName?: string | null
  lang?: string | null
  publishedTime?: string | null
  pageTitle?: string | null
}

export interface ArticleDraft {
  book: DraftBook
  pictureUrls: Map<number, string>
  capped: number
}

export type DraftResult = { ok: true; draft: ArticleDraft } | { ok: false; problem: 'no_article' }

const line = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim()
const capped = (text: string, max: number) => (text.length > max ? text.slice(0, max).trimEnd() : text)
const sameText = (a: string, b: string) => line(a).toLowerCase() === line(b).toLowerCase()

function absolute(address: string | undefined, base: string): string | null {
  const text = address?.trim()
  if (!text) return null
  try {
    const url = new URL(text, base)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

const pixels = (value: string | undefined) => (value && /^\d+$/.test(value.trim()) ? Number(value) : null)

function settlePictures(root: ReturnType<typeof parseHtml>, base: string) {
  const sizes = new Map<string, { width: number; height: number }>()
  for (const img of root.querySelectorAll('img')) {
    const fromSet = chooseCandidate(parseSrcset(img.getAttribute('srcset') ?? ''))
    const chosen = absolute(fromSet ?? img.getAttribute('src'), base)
    img.removeAttribute('srcset')
    if (!chosen) {
      img.removeAttribute('src')
      continue
    }
    img.setAttribute('src', chosen)
    const width = pixels(img.getAttribute('width'))
    const height = pixels(img.getAttribute('height'))
    if (width && height) sizes.set(chosen, { width, height })
  }
  return sizes
}

function lookupOf(sizes: Map<string, { width: number; height: number }>) {
  const pictures: SourcePicture[] = []
  const urls = new Map<number, string>()
  const numbers = new Map<string, number>()
  const known = new Map<number, { width: number; height: number } | null>()
  let over = 0
  const add = (key: string, url: string | null) => {
    const seen = numbers.get(key)
    if (seen) return seen
    const keep = url !== null && urls.size < MAX_ARTICLE_PICTURES
    if (url !== null && !keep) over++
    pictures.push(keep ? { key, problem: 'remote' } : { key, problem: 'unreadable' })
    const pictureNumber = pictures.length
    numbers.set(key, pictureNumber)
    known.set(pictureNumber, url ? (sizes.get(url) ?? null) : null)
    if (keep) urls.set(pictureNumber, url)
    return pictureNumber
  }
  const lookup: PictureLookup = {
    file: (src) => add(src, /^https?:/i.test(src) ? src : null),
    svg: (text) => add(`svg:${text}`, null),
    size: (n) => known.get(n) ?? null,
  }
  return { lookup, pictures, urls, capped: () => over }
}

const runsText = (runs: readonly Run[]) => runs.map((r) => ('text' in r ? r.text : ' ')).join('')

function textOf(block: BookBlock | ListBlock): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return runsText(block.runs)
    case 'blockquote':
      return block.paragraphs.map(runsText).join(' ')
    case 'list':
      return block.items.map((item) => [runsText(item.runs), ...(item.lists ?? []).map(textOf)].join(' ')).join(' ')
    case 'table':
      return [...block.head, ...block.body].map((row) => row.map(runsText).join(' ')).join(' ')
    case 'code':
      return block.text
    case 'image':
      return block.caption ? runsText(block.caption) : ''
  }
}

function blocksOf(items: readonly HtmlItem[], title: string): BookBlock[] {
  const blocks: BookBlock[] = []
  let firstHeading = true
  for (const item of items) {
    if (item.kind === 'block') {
      blocks.push(item.block)
      continue
    }
    const repeat = firstHeading && sameText(item.title, title)
    firstHeading = false
    if (repeat || !line(runsText(item.runs))) continue
    blocks.push({ type: 'heading', level: item.level <= 2 ? 3 : 4, runs: item.runs })
  }
  return blocks
}

export function draftArticle(result: ReadabilityResult | null, finalUrl: string): DraftResult {
  if (!result?.content) return { ok: false, problem: 'no_article' }
  const site = siteOf(finalUrl)
  const title = capped(line(result.title) || line(result.pageTitle) || site, TITLE_MAX)
  const root = parseHtml(result.content)
  const pictures = lookupOf(settlePictures(root, finalUrl))
  const items: HtmlItem[] = []
  walkHtml(root, items, { pictures: pictures.lookup })
  const blocks = blocksOf(items, title)
  const characters = line(blocks.map(textOf).join(' ')).length
  if (characters < MIN_ARTICLE_CHARACTERS) return { ok: false, problem: 'no_article' }

  const byline = line(result.byline).replace(/^by\s+/i, '')
  const siteName = line(result.siteName)
  const lang = line(result.lang)
  const book = finishDraft({
    title,
    author: capped(byline || siteName || site, AUTHOR_MAX),
    language: LANGUAGE_TAG.test(lang) ? lang : 'en',
    details: {
      description: cleanDescription(result.excerpt),
      isbn: null,
      publisher: capped(siteName || site, PUBLISHER_MAX),
      publishedYear: yearFrom(result.publishedTime),
    },
    cover: null,
    chapters: [{ title, blocks }],
    pictures: pictures.pictures,
  })
  return { ok: true, draft: { book, pictureUrls: pictures.urls, capped: pictures.capped() } }
}
