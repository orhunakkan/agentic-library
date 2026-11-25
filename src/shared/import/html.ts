import { type HTMLElement, type Node, NodeType, parse, TextNode } from 'node-html-parser'
import { codeLang } from '../run-code/langs.ts'
import {
  type BookBlock,
  cleanAlt,
  type ImageBlock,
  type InlineStyle,
  type ListBlock,
  type ListItem,
  type Run,
} from './blocks.ts'
import { IMAGE_MIN_SIDE, INLINE_IMAGE_MIN_WIDTH } from './limits.ts'
import { hasText, renderBlock, renderRuns } from './render.ts'

const SKIP = new Set(['hr', 'nav', 'script', 'noscript', 'style', 'math', 'aside', 'iframe', 'object', 'embed'])
const PICTURE = new Set(['img', 'figure', 'svg'])
const STYLES = new Map<string, InlineStyle>([
  ['strong', 'strong'],
  ['b', 'strong'],
  ['em', 'em'],
  ['i', 'em'],
  ['sup', 'sup'],
  ['sub', 'sub'],
])

export type HtmlItem =
  | { kind: 'heading'; level: number; title: string; runs: Run[] }
  | { kind: 'block'; block: BookBlock }

export interface PictureLookup {
  file(src: string): number
  svg(text: string): number
  size(n: number): { width: number; height: number } | null
}

export interface WalkOptions {
  pictures?: PictureLookup
  titleAsCaption?: boolean
}

interface Walk extends WalkOptions {
  lifted: ImageBlock[] | null
}

/**
 * node-html-parser looks tag names up in plain objects, so a tag named like an Object.prototype property, such
 * as `<constructor>` or `<toString>`, closes the elements around it and its text falls out of the paragraph.
 * Renaming those tags before parsing makes them unknown elements like any other.
 */
const PROTOTYPE_TAG = new RegExp(
  `<(/?)(${Object.getOwnPropertyNames(Object.prototype)
    .filter((name) => /^[a-z]+$/i.test(name))
    .join('|')})(?=[\\s/>])`,
  'gi',
)

export function parseHtml(html: string): HTMLElement {
  return parse(html.replace(PROTOTYPE_TAG, '<$1x-$2'), {
    comment: false,
    blockTextElements: { script: true, noscript: true, style: true },
  })
}

function tagOf(node: Node): string {
  return node.nodeType === NodeType.ELEMENT_NODE ? ((node as HTMLElement).rawTagName ?? '').toLowerCase() : ''
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ')
}

const isText = (run: Run | ListBlock): run is { text: string; style?: InlineStyle } => 'text' in run

function mergeText(runs: Run[]): Run[] {
  const out: Run[] = []
  for (const run of runs) {
    const last = out.at(-1)
    if ('text' in run && !run.style) {
      if (!run.text) continue
      if (last && 'text' in last && !last.style) {
        out[out.length - 1] = { text: last.text + run.text }
        continue
      }
    }
    out.push(run)
  }
  return out
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const DRAWING = 'path, rect, circle, ellipse, line, polyline, polygon, text, use, foreignObject'

function framedImage(svg: HTMLElement): string | null {
  const images = svg.querySelectorAll('image')
  if (images.length !== 1 || svg.querySelectorAll(DRAWING).length) return null
  const image = images[0] as HTMLElement
  return image.getAttribute('href') ?? image.getAttribute('xlink:href') ?? null
}

function svgDocument(svg: HTMLElement): string {
  const text = svg.toString().replace(/&nbsp;/g, '&#160;')
  const open = /^<svg\b[^>]*>/i.exec(text)?.[0] ?? ''
  let root = open
  if (!/\sxmlns\s*=/.test(root)) root = root.replace(/^<svg\b/i, `<svg xmlns="${SVG_NS}"`)
  if (/\bxlink:/.test(text) && !/\sxmlns:xlink\s*=/.test(root))
    root = root.replace(/^<svg\b/i, `<svg xmlns:xlink="${XLINK_NS}"`)
  return root + text.slice(open.length)
}

function pictureOf(el: HTMLElement, pictures: PictureLookup): { n: number; alt: string; title: string } | null {
  if (tagOf(el) === 'img') {
    const src = el.getAttribute('src')?.trim()
    if (!src) return null
    return { n: pictures.file(src), alt: cleanAlt(el.getAttribute('alt') ?? ''), title: el.getAttribute('title') ?? '' }
  }
  const label = el.getAttribute('aria-label') ?? el.querySelector('title')?.text ?? ''
  const framed = framedImage(el)
  const n = framed ? pictures.file(framed.trim()) : pictures.svg(svgDocument(el))
  return { n, alt: cleanAlt(label), title: '' }
}

const isSpacer = (size: { width: number; height: number } | null) =>
  size !== null && (size.width < IMAGE_MIN_SIDE || size.height < IMAGE_MIN_SIDE)

function captionOf(text: string, walk: Walk): Run[] | undefined {
  const runs = walk.titleAsCaption ? trimRuns([{ text: collapse(text) }]) : []
  return runs.length ? runs : undefined
}

function imageBlock(n: number, alt: string, caption?: Run[]): ImageBlock {
  return caption ? { type: 'image', image: n, alt, caption } : { type: 'image', image: n, alt }
}

function inlinePicture(el: HTMLElement, walk: Walk): Run[] {
  const pictures = walk.pictures
  const picture = pictures && pictureOf(el, pictures)
  if (!pictures || !picture) return []
  const size = pictures.size(picture.n)
  if (isSpacer(size)) return []
  if (walk.lifted && (!size || size.width >= INLINE_IMAGE_MIN_WIDTH)) {
    walk.lifted.push(imageBlock(picture.n, picture.alt, captionOf(picture.title, walk)))
    return []
  }
  return picture.alt ? [{ text: picture.alt }] : []
}

function inlineNode(node: Node, walk: Walk): Run[] {
  if (node instanceof TextNode) return [{ text: collapse(node.text) }]
  if (node.nodeType !== NodeType.ELEMENT_NODE) return []
  const tag = tagOf(node)
  if (SKIP.has(tag)) return []
  if (PICTURE.has(tag)) {
    if (!walk.pictures) return []
    if (tag !== 'figure') return inlinePicture(node as HTMLElement, walk)
    const start = walk.lifted?.length ?? 0
    const runs = node.childNodes.filter((c) => tagOf(c) !== 'figcaption').flatMap((c) => inlineNode(c, walk))
    if (walk.lifted) attachCaption(walk.lifted, start, node as HTMLElement, walk)
    return runs
  }
  if (tag === 'br') return [{ br: true }]
  if (tag === 'code') return [{ text: collapse(node.text), style: 'code' }]
  const inner = inlineRuns(node, walk)
  const style = STYLES.get(tag)
  if (!style || !renderRuns(inner).trim()) return inner
  return inner.map((run) => ('text' in run && !run.style ? { text: run.text, style } : run))
}

function inlineRuns(node: Node, walk: Walk): Run[] {
  return mergeText(node.childNodes.flatMap((c) => inlineNode(c, walk)))
}

function trimSequence<T extends Run | ListBlock>(items: readonly T[]): T[] {
  const out = [...items]
  while (out.length) {
    const first = trimEdge(out[0] as T, /^\s+/)
    if (first) {
      out[0] = first
      break
    }
    out.shift()
  }
  while (out.length) {
    const last = trimEdge(out[out.length - 1] as T, /\s+$/)
    if (last) {
      out[out.length - 1] = last
      break
    }
    out.pop()
  }
  return out
}

function trimEdge<T extends Run | ListBlock>(item: T, edge: RegExp): T | null {
  if ('br' in item) return null
  if (!isText(item) || item.style) return item
  const text = item.text.replace(edge, '')
  return text ? ({ text } as T) : null
}

const trimRuns = (runs: Run[]): Run[] => trimSequence(runs)

function codeOf(pre: HTMLElement): BookBlock {
  const children = pre.childNodes.filter((c) => c.nodeType === NodeType.ELEMENT_NODE)
  const code = children.length === 1 && tagOf(children[0] as Node) === 'code' ? (children[0] as HTMLElement) : null
  const lang = codeLang(code ? [pre, code] : [pre])
  return lang ? { type: 'code', text: pre.text, lang } : { type: 'code', text: pre.text }
}

function listItems(list: HTMLElement, walk: Walk): ListItem[] {
  const items: ListItem[] = []
  for (const li of list.childNodes) {
    if (tagOf(li) !== 'li') continue
    let parts: (Run | ListBlock)[] = []
    const rendered = () => parts.some((p) => !isText(p) || p.style || p.text)
    for (const part of li.childNodes) {
      const tag = tagOf(part)
      if (tag === 'ul' || tag === 'ol') parts.push(listBlock(part as HTMLElement, walk))
      else if (tag === 'p' || tag === 'div') {
        if (rendered()) parts.push({ text: ' ' })
        parts.push(...trimRuns(inlineRuns(part, walk)))
      } else if (tag === 'pre') parts.push({ br: true }, { text: collapse(part.text).trim(), style: 'code' })
      else parts.push(...inlineNode(part, walk))
    }
    parts = trimSequence(parts)
    const runs = mergeText(parts.filter((p): p is Run => !('type' in p)))
    const lists = parts.filter((p): p is ListBlock => 'type' in p)
    items.push(lists.length ? { runs, lists } : { runs })
  }
  return items
}

function listBlock(el: HTMLElement, walk: Walk): ListBlock {
  return { type: 'list', ordered: tagOf(el) === 'ol', items: listItems(el, walk) }
}

function tableRows(table: HTMLElement, walk: Walk): { head: Run[][][]; body: Run[][][] } {
  const head: Run[][][] = []
  const body: Run[][][] = []
  for (const section of table.childNodes) {
    const tag = tagOf(section)
    if (tag !== 'thead' && tag !== 'tbody' && tag !== 'tr') continue
    const rows = tag === 'tr' ? [section] : section.childNodes.filter((r) => tagOf(r) === 'tr')
    for (const row of rows) {
      const cells = row.childNodes.filter((c) => tagOf(c) === 'th' || tagOf(c) === 'td')
      if (cells.every((c) => !c.text.trim() && !(walk.pictures && (c as HTMLElement).querySelector('img, svg'))))
        continue
      ;(tag === 'thead' ? head : body).push(cells.map((c) => trimRuns(inlineRuns(c, walk))))
    }
  }
  return { head, body }
}

function quotedParagraphs(el: HTMLElement): HTMLElement[] {
  return el.childNodes.flatMap((c) => {
    const tag = tagOf(c)
    if (tag === 'p') return [c as HTMLElement]
    return tag === 'header' || tag === 'footer' || tag === 'div' ? quotedParagraphs(c as HTMLElement) : []
  })
}

function blockquote(el: HTMLElement, walk: Walk): BookBlock {
  const paragraphs = quotedParagraphs(el)
  return {
    type: 'blockquote',
    paragraphs: paragraphs.length
      ? paragraphs.map((p) => trimRuns(inlineRuns(p, walk)))
      : [trimRuns(inlineRuns(el, walk))],
  }
}

function figureCaption(figure: HTMLElement, walk: Walk): Run[] {
  const el = figure.childNodes.find((c) => tagOf(c) === 'figcaption')
  return el ? trimRuns(inlineRuns(el, { ...walk, lifted: null })) : []
}

function attachCaption(blocks: ImageBlock[], start: number, figure: HTMLElement, walk: Walk): boolean {
  const caption = figureCaption(figure, walk)
  if (!hasText(renderRuns(caption))) return true
  const last = blocks.slice(start).at(-1)
  if (!last) return false
  last.caption = caption
  return true
}

export function walkHtml(node: Node, out: HtmlItem[], options: WalkOptions = {}): void {
  walk(node, out, { ...options, lifted: [] })
}

function walk(node: Node, out: HtmlItem[], state: Walk, except = ''): void {
  const push = (block: BookBlock) => {
    if (renderBlock(block) || block.type === 'image') out.push({ kind: 'block', block })
  }
  const withLifted = (make: (walk: Walk) => HtmlItem | BookBlock) => {
    const lifted: ImageBlock[] = []
    const item = make({ ...state, lifted })
    if ('kind' in item) out.push(item)
    else push(item)
    for (const block of lifted) push(block)
  }
  for (const child of node.childNodes) {
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue
    const el = child as HTMLElement
    const tag = tagOf(el)
    if (tag === except) continue
    const heading = /^h([1-6])$/.exec(tag)
    if (heading)
      withLifted((w) => ({
        kind: 'heading',
        level: Number(heading[1]),
        title: collapse(el.text).trim(),
        runs: trimRuns(inlineRuns(el, w)),
      }))
    else if (tag === 'p') withLifted((w) => ({ type: 'paragraph', runs: trimRuns(inlineRuns(el, w)) }))
    else if (tag === 'pre') push(codeOf(el))
    else if (tag === 'ul' || tag === 'ol') withLifted((w) => listBlock(el, w))
    else if (tag === 'table') withLifted((w) => ({ type: 'table', ...tableRows(el, w) }))
    else if (tag === 'blockquote') withLifted((w) => blockquote(el, w))
    else if (PICTURE.has(tag)) {
      if (state.pictures) blockPicture(el, out, state)
    } else if (!SKIP.has(tag)) walk(el, out, state)
  }
}

function blockPicture(el: HTMLElement, out: HtmlItem[], state: Walk): void {
  const pictures = state.pictures as PictureLookup
  if (tagOf(el) !== 'figure') {
    const picture = pictureOf(el, pictures)
    if (picture && !isSpacer(pictures.size(picture.n)))
      out.push({ kind: 'block', block: imageBlock(picture.n, picture.alt, captionOf(picture.title, state)) })
    return
  }
  const start = out.length
  walk(el, out, state, 'figcaption')
  const images = out
    .slice(start)
    .flatMap((item) => (item.kind === 'block' && item.block.type === 'image' ? [item.block] : []))
  if (!attachCaption(images, 0, el, state))
    out.push({ kind: 'block', block: { type: 'image', image: 0, alt: '', caption: figureCaption(el, state) } })
}
