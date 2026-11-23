import type { RunLang } from '../run-code/langs.ts'
import type { BookBlock, ImageBlock, ListBlock, ListItem, Run } from './blocks.ts'
import { pageWeight } from './image.ts'

export interface Block {
  html: string
  words: number
  heading: boolean
}

export interface RenderContext {
  imageSrc(n: number): string
  imageSize(n: number): { width: number; height: number } | null
}

export const NO_PICTURES: RenderContext = { imageSrc: () => '', imageSize: () => null }

const WORDS_PER_CODE_LINE = 9

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;')
}

export function countWords(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, 'x')
  const m = text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)
  return m ? m.length : 0
}

export const hasText = (html: string): boolean => Boolean(html.replace(/<[^>]+>/g, '').trim())

export function textBlock(tag: 'p' | 'blockquote' | 'ul' | 'ol' | 'table', inner: string): Block | null {
  if (!hasText(inner)) return null
  const html = `<${tag}>${inner}</${tag}>`
  return { html, words: countWords(html), heading: false }
}

export function headingBlock(level: 3 | 4, inner: string): Block | null {
  if (!hasText(inner)) return null
  return { html: `<h${level}>${inner}</h${level}>`, words: countWords(inner), heading: true }
}

export function codeBlock(code: string, lang?: RunLang): Block | null {
  const lines = code.replace(/\t/g, '  ').replace(/\s+$/, '').split('\n')
  while (lines.length && !lines[0]?.trim()) lines.shift()
  if (!lines.length) return null
  return {
    html: `<pre${lang ? ` data-lang="${escapeAttribute(lang)}"` : ''}>${escapeHtml(lines.map((l) => l.trimEnd()).join('\n'))}</pre>`,
    words: lines.length * WORDS_PER_CODE_LINE,
    heading: false,
  }
}

export function figureBlock(block: ImageBlock, context: RenderContext): Block | null {
  const caption = renderRuns(block.caption ?? [])
  const hasCaption = hasText(caption)
  const figcaption = hasCaption ? `<figcaption>${caption}</figcaption>` : ''
  const size = block.image > 0 ? context.imageSize(block.image) : null
  if (!size)
    return hasCaption ? { html: `<figure>${figcaption}</figure>`, words: countWords(caption), heading: false } : null
  const src = escapeAttribute(context.imageSrc(block.image))
  const label = block.alt ? '' : ' aria-label="View picture"'
  const img = `<img src="${src}" alt="${escapeAttribute(block.alt)}" width="${size.width}" height="${size.height}" loading="lazy" decoding="async">`
  return {
    html: `<figure><a href="${src}"${label}>${img}</a>${figcaption}</figure>`,
    words: pageWeight(size.width, size.height) + (hasCaption ? countWords(caption) : 0),
    heading: false,
  }
}

export function renderRuns(runs: readonly Run[]): string {
  let html = ''
  for (const run of runs) {
    if ('br' in run) html += '<br>'
    else if (run.style) html += `<${run.style}>${escapeHtml(run.text)}</${run.style}>`
    else html += escapeHtml(run.text)
  }
  return html
}

function renderItem(item: ListItem): string {
  return `<li>${renderRuns(item.runs)}${(item.lists ?? []).map(renderList).join('')}</li>`
}

function renderList(list: ListBlock): string {
  const tag = list.ordered ? 'ol' : 'ul'
  return `<${tag}>${list.items.map(renderItem).join('')}</${tag}>`
}

function renderRows(rows: Run[][][], section: 'thead' | 'tbody', cell: 'th' | 'td'): string {
  if (!rows.length) return ''
  const html = rows.map((row) => `<tr>${row.map((c) => `<${cell}>${renderRuns(c)}</${cell}>`).join('')}</tr>`)
  return `<${section}>${html.join('')}</${section}>`
}

export function renderBlock(block: BookBlock, context: RenderContext = NO_PICTURES): Block | null {
  switch (block.type) {
    case 'heading':
      return headingBlock(block.level, renderRuns(block.runs))
    case 'paragraph':
      return textBlock('p', renderRuns(block.runs))
    case 'blockquote':
      return textBlock('blockquote', block.paragraphs.map((p) => `<p>${renderRuns(p)}</p>`).join(''))
    case 'list':
      return textBlock(block.ordered ? 'ol' : 'ul', block.items.map(renderItem).join(''))
    case 'table':
      return textBlock('table', renderRows(block.head, 'thead', 'th') + renderRows(block.body, 'tbody', 'td'))
    case 'code':
      return codeBlock(block.text, block.lang)
    case 'image':
      return figureBlock(block, context)
  }
}

export function renderBlocks(blocks: readonly BookBlock[], context: RenderContext = NO_PICTURES): Block[] {
  return blocks.map((b) => renderBlock(b, context)).filter((b) => b !== null)
}
