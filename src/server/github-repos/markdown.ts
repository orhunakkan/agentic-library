import '@tanstack/react-start/server-only'
import { nameToEmoji } from 'gemoji'
import GithubSlugger from 'github-slugger'
import { Marked } from 'marked'
import { type HTMLElement, type Node, NodeType, parse, type TextNode } from 'node-html-parser'
import type {
  AlertKind,
  CodeTokens,
  FrontMatterField,
  MdAlign,
  MdAttrs,
  MdImageSource,
  MdLinkTarget,
  MdNode,
  MdTag,
  RenderedMarkdown,
} from '../../shared/github-repos/md-node.ts'
import { isMdTag } from '../../shared/github-repos/md-node.ts'
import { highlight, languageForFence } from './highlight.ts'

export interface MarkdownContext {
  owner: string
  name: string
  folder: string
  kindOf: (path: string) => 'file' | 'folder' | null
}

const marked = new Marked({ gfm: true, async: false })

const DROP = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'textarea',
  'button',
  'select',
  'svg',
  'math',
  'noscript',
  'template',
])

const BLOCK = new Set([
  'blockquote',
  'details',
  'div',
  'dl',
  'dd',
  'dt',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'table',
  'ul',
])
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const ALIGNED = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th'])
const TABLE_SECTIONS = new Set(['thead', 'tbody', 'tfoot'])
const LITERAL = new Set(['code', 'pre', 'kbd', 'samp'])
const ALERTS: Record<string, AlertKind> = {
  NOTE: 'note',
  TIP: 'tip',
  IMPORTANT: 'important',
  WARNING: 'warning',
  CAUTION: 'caution',
}
const MAX_DEPTH = 40

const RAW_HOST = 'raw.githubusercontent.com'
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])

export function resolvePath(folder: string, ref: string): string | null {
  const parts = ref.startsWith('/') ? [] : folder.split('/').filter(Boolean)
  for (const segment of ref.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(segment)
  }
  return parts.join('/')
}

const safeDecode = (text: string): string | null => {
  try {
    return decodeURIComponent(text)
  } catch {
    return null
  }
}

export function cleanUrl(raw: string): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: these are the characters a browser drops or trims.
  const url = raw.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '')
  // biome-ignore lint/suspicious/noControlCharactersInRegex: a control character left inside makes the URL unsafe.
  if (/[\u0000-\u001f\u007f]/.test(url)) return null
  return url.replaceAll('\\', '/')
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/i

type Address =
  | { kind: 'absolute'; url: URL }
  | { kind: 'relative'; path: string; query: string; fragment: string | null }
  | { kind: 'refused' }

function readAddress(raw: string): Address {
  const url = cleanUrl(raw)
  if (url === null) return { kind: 'refused' }
  const absolute = url.startsWith('//') ? `https:${url}` : SCHEME.test(url) ? url : null
  if (absolute !== null) {
    try {
      return { kind: 'absolute', url: new URL(absolute) }
    } catch {
      return { kind: 'refused' }
    }
  }
  const hash = url.indexOf('#')
  const beforeHash = hash === -1 ? url : url.slice(0, hash)
  const fragment = hash === -1 ? null : url.slice(hash + 1)
  const queryStart = beforeHash.indexOf('?')
  const encodedPath = queryStart === -1 ? beforeHash : beforeHash.slice(0, queryStart)
  const path = safeDecode(encodedPath)
  if (path === null) return { kind: 'refused' }
  return { kind: 'relative', path, query: queryStart === -1 ? '' : beforeHash.slice(queryStart), fragment }
}

const anchorId = (fragment: string) => `user-content-${safeDecode(fragment) ?? fragment}`

export function linkTarget(href: string, folder: string): MdLinkTarget | null {
  const address = readAddress(href)
  if (address.kind === 'refused') return null
  if (address.kind === 'absolute') {
    const scheme = address.url.protocol
    return scheme === 'https:' || scheme === 'http:' || scheme === 'mailto:'
      ? { kind: 'external', href: address.url.href }
      : null
  }
  if (!address.path) {
    if (!address.fragment) return null
    return { kind: 'anchor', id: anchorId(address.fragment) }
  }
  const path = resolvePath(folder, address.path)
  if (path === null) return null
  return { kind: 'repo', path, anchor: address.fragment ? anchorId(address.fragment) : null }
}

function repoPathAfterRef(segments: readonly string[], kindOf: MarkdownContext['kindOf']): string | null {
  for (let refLength = 1; refLength <= 3 && refLength < segments.length; refLength++) {
    const path = segments.slice(refLength).join('/')
    if (kindOf(path) === 'file') return path
  }
  return null
}

export function imageSource(src: string, context: MarkdownContext): MdImageSource | null {
  const address = readAddress(src)
  if (address.kind === 'refused') return null
  if (address.kind === 'relative') {
    if (!address.path) return null
    const path = resolvePath(context.folder, address.path)
    return path ? { kind: 'repo', path } : null
  }
  const { url } = address
  if (url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').slice(1).map(safeDecode)
  if (segments.every((s): s is string => s !== null)) {
    const sameRepo =
      segments[0]?.toLowerCase() === context.owner.toLowerCase() &&
      segments[1]?.toLowerCase() === context.name.toLowerCase()
    if (sameRepo && host === RAW_HOST) {
      const path = repoPathAfterRef(segments.slice(2), context.kindOf)
      if (path) return { kind: 'repo', path }
    }
    const githubForm = segments[2] === 'raw' || (segments[2] === 'blob' && url.searchParams.get('raw') === 'true')
    if (sameRepo && GITHUB_HOSTS.has(host) && githubForm) {
      const path = repoPathAfterRef(segments.slice(3), context.kindOf)
      if (path) return { kind: 'repo', path }
    }
  }
  return { kind: 'external', src: url.href, host: url.host }
}

const FRONT_MATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

export function readFrontMatter(markdown: string): { fields: FrontMatterField[]; body: string } {
  const match = FRONT_MATTER.exec(markdown)
  if (!match) return { fields: [], body: markdown }
  const fields: FrontMatterField[] = []
  let current: { key: string; first: string; more: string[] } | null = null
  const finish = () => {
    if (!current) return
    const { key, first, more } = current
    const single = more.length === 0 && first !== '' && first !== '|' && first !== '>' && !/^[|>][-+]?$/.test(first)
    fields.push(
      single
        ? { key, value: unquote(first), yaml: false }
        : { key, value: [first, ...more].filter((line, i) => i > 0 || line !== '').join('\n'), yaml: true },
    )
    current = null
  }
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const pair = /^([^\s:#][^:]*?)\s*:(?:\s+(.*)|\s*)$/.exec(line)
    if (pair?.[1] && !/^\s/.test(line)) {
      finish()
      current = { key: pair[1], first: (pair[2] ?? '').trim(), more: [] }
    } else if (current && line.trim() !== '') current.more.push(line)
  }
  finish()
  return { fields, body: markdown.slice(match[0].length) }
}

function unquote(value: string): string {
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value
}

interface Walk {
  context: MarkdownContext
  slugger: GithubSlugger
  codes: { node: { code: CodeTokens }; text: string; lang: string | null }[]
  externalImages: number
}

interface Scope {
  depth: number
  parent: string
  inLink: boolean
  inListItem: boolean
  inDefinition: boolean
  literal: boolean
}

const isElement = (node: Node): node is HTMLElement => node.nodeType === NodeType.ELEMENT_NODE
const isTextNode = (node: Node): node is TextNode => node.nodeType === NodeType.TEXT_NODE
const tagOf = (node: HTMLElement) => (node.rawTagName ?? '').toLowerCase()

function emojify(text: string): string {
  return text.replace(/:([a-z0-9_+-]+):/g, (whole, name: string) => nameToEmoji[name] ?? whole)
}

function textNode(text: string, scope: Scope): MdNode[] {
  if (!text) return []
  return [{ t: 'text', v: scope.literal ? text : emojify(text) }]
}

function alignOf(value: string | undefined): MdAlign | undefined {
  const align = value?.trim().toLowerCase()
  return align === 'left' || align === 'center' || align === 'right' ? align : undefined
}

function boundedInt(value: string | undefined, max: number, digits: number): number | undefined {
  const text = value?.trim()
  if (!text || !new RegExp(`^\\d{1,${digits}}$`).test(text)) return undefined
  const n = Number(text)
  return n >= 1 && n <= max ? n : undefined
}

function attrsFor(tag: MdTag, element: HTMLElement): MdAttrs | undefined {
  const attrs: MdAttrs = {}
  const title = element.getAttribute('title')
  if (title) attrs.title = title
  if (ALIGNED.has(tag)) {
    const align = alignOf(element.getAttribute('align'))
    if (align) attrs.align = align
  }
  if (tag === 'td' || tag === 'th') {
    const colSpan = boundedInt(element.getAttribute('colspan'), 100, 3)
    const rowSpan = boundedInt(element.getAttribute('rowspan'), 100, 3)
    if (colSpan) attrs.colSpan = colSpan
    if (rowSpan) attrs.rowSpan = rowSpan
  }
  if (tag === 'details' && element.hasAttribute('open')) attrs.open = true
  if (tag === 'ol') {
    const start = element.getAttribute('start')?.trim()
    if (start && /^-?\d{1,9}$/.test(start)) attrs.start = Number(start)
  }
  return Object.keys(attrs).length ? attrs : undefined
}

function isTaskBox(node: Node | undefined): node is HTMLElement {
  return (
    !!node &&
    isElement(node) &&
    tagOf(node) === 'input' &&
    node.getAttribute('type')?.toLowerCase() === 'checkbox' &&
    node.hasAttribute('disabled')
  )
}

function walkChildren(element: HTMLElement, scope: Scope, walk: Walk): MdNode[] {
  return element.childNodes.flatMap((child) => walkNode(child, scope, walk))
}

function walkNode(node: Node, scope: Scope, walk: Walk): MdNode[] {
  if (isTextNode(node)) return textNode(node.text, scope)
  if (!isElement(node)) return []
  const tag = tagOf(node)
  if (DROP.has(tag)) return []
  if (scope.depth >= MAX_DEPTH) return textNode(node.text, scope)
  const inner: Scope = { ...scope, depth: scope.depth + 1, parent: tag }

  if (tag === 'picture') {
    return node.childNodes.filter((c) => isElement(c) && tagOf(c) === 'img').flatMap((c) => walkNode(c, scope, walk))
  }
  if (tag === 'img') return image(node, walk)
  if (tag === 'a') return link(node, scope, inner, walk)
  if (tag === 'pre') {
    const elements = node.childNodes.filter((c) => isElement(c) || c.text.trim() !== '')
    const only = elements[0]
    if (elements.length === 1 && only && isElement(only) && tagOf(only) === 'code') return fencedCode(only, walk)
    return [{ t: 'el', tag: 'pre', c: walkChildren(node, { ...inner, literal: true }, walk) }]
  }
  if (tag === 'blockquote') {
    const alert = alertOf(node, inner, walk)
    if (alert) return [alert]
  }
  if (tag === 'li') return [listItem(node, scope, inner, walk)]
  if (!isMdTag(tag)) return walkChildren(node, scope, walk)

  let finalTag: MdTag = tag
  if (HEADINGS.has(tag) && HEADINGS.has(scope.parent)) finalTag = 'span'
  if ((tag === 'dt' || tag === 'dd') && scope.inDefinition) finalTag = 'div'
  const childScope: Scope = {
    ...inner,
    parent: finalTag,
    literal: scope.literal || LITERAL.has(tag),
    inListItem: tag === 'ul' || tag === 'ol' ? false : scope.inListItem,
    inDefinition: tag === 'dl' ? false : tag === 'dt' || tag === 'dd' ? true : scope.inDefinition,
  }
  const children = walkChildren(node, childScope, walk)
  const attrs = attrsFor(finalTag, node) ?? {}
  if (HEADINGS.has(finalTag)) attrs.id = `user-content-${walk.slugger.slug(node.text)}`
  const element: MdNode = { t: 'el', tag: finalTag, c: children }
  if (Object.keys(attrs).length) element.attrs = attrs
  return [element]
}

function listItem(node: HTMLElement, scope: Scope, inner: Scope, walk: Walk): MdNode {
  const childScope: Scope = { ...inner, parent: scope.inListItem ? 'div' : 'li', inListItem: true }
  let children: MdNode[]
  const first = node.childNodes[0]
  const firstOfParagraph = first && isElement(first) && tagOf(first) === 'p' ? first.childNodes[0] : undefined
  if (isTaskBox(first)) {
    const rest = node.childNodes.slice(1).flatMap((c) => walkNode(c, childScope, walk))
    children = [{ t: 'task', checked: first.hasAttribute('checked') }, ...rest]
  } else if (first && isElement(first) && isTaskBox(firstOfParagraph)) {
    const paragraphScope: Scope = { ...childScope, depth: childScope.depth + 1, parent: 'p' }
    const paragraph: MdNode = {
      t: 'el',
      tag: 'p',
      c: [
        { t: 'task', checked: firstOfParagraph.hasAttribute('checked') },
        ...first.childNodes.slice(1).flatMap((c) => walkNode(c, paragraphScope, walk)),
      ],
    }
    children = [paragraph, ...node.childNodes.slice(1).flatMap((c) => walkNode(c, childScope, walk))]
  } else children = walkChildren(node, childScope, walk)
  return { t: 'el', tag: scope.inListItem ? 'div' : 'li', c: children }
}

function link(node: HTMLElement, scope: Scope, inner: Scope, walk: Walk): MdNode[] {
  const href = node.getAttribute('href')
  const to = href && !scope.inLink ? linkTarget(href, walk.context.folder) : null
  const children = walkChildren(node, to ? { ...inner, inLink: true } : scope, walk)
  if (!to) return children
  const title = node.getAttribute('title')
  return [{ t: 'link', to, ...(title ? { title } : {}), c: children }]
}

function image(node: HTMLElement, walk: Walk): MdNode[] {
  const alt = node.getAttribute('alt') ?? ''
  const src = node.getAttribute('src')
  const source = src ? imageSource(src, walk.context) : null
  if (!source) return alt ? [{ t: 'text', v: alt }] : []
  if (source.kind === 'external') walk.externalImages++
  const picture: MdNode = { t: 'img', source, alt }
  const title = node.getAttribute('title')
  if (title) picture.title = title
  const width = boundedInt(node.getAttribute('width'), 9999, 4)
  const height = boundedInt(node.getAttribute('height'), 9999, 4)
  if (width) picture.width = width
  if (height) picture.height = height
  const align = alignOf(node.getAttribute('align'))
  if (align) picture.align = align
  return [picture]
}

function fencedCode(code: HTMLElement, walk: Walk): MdNode[] {
  const language = /(?:^|\s)language-(\S+)/.exec(code.getAttribute('class') ?? '')?.[1] ?? ''
  const lang = languageForFence(language)
  const node = { t: 'code' as const, lang, code: { palette: [], lines: [], highlighted: false } as CodeTokens }
  walk.codes.push({ node, text: code.text, lang })
  return [node]
}

function alertOf(node: HTMLElement, inner: Scope, walk: Walk): MdNode | null {
  const children = node.childNodes.filter((c) => isElement(c) || c.text.trim() !== '')
  const paragraph = children[0]
  if (!paragraph || !isElement(paragraph) || tagOf(paragraph) !== 'p') return null
  const firstText = paragraph.childNodes[0]
  if (!firstText || !isTextNode(firstText)) return null
  const marker = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i.exec(firstText.text)
  if (!marker?.[1]) return null
  const kind = ALERTS[marker[1].toUpperCase()] as AlertKind
  const scope: Scope = { ...inner, parent: 'div' }
  const paragraphScope: Scope = { ...scope, depth: scope.depth + 1, parent: 'p' }
  const rest = firstText.text.slice(marker[0].length)
  const paragraphChildren = [
    ...textNode(rest, paragraphScope),
    ...paragraph.childNodes.slice(1).flatMap((c) => walkNode(c, paragraphScope, walk)),
  ]
  const firstChild = paragraphChildren[0]
  if (firstChild?.t === 'el' && firstChild.tag === 'br') paragraphChildren.shift()
  const body: MdNode[] = []
  if (paragraphChildren.some((c) => c.t !== 'text' || c.v.trim() !== ''))
    body.push({ t: 'el', tag: 'p', c: paragraphChildren })
  const after = node.childNodes.slice(node.childNodes.indexOf(paragraph) + 1)
  body.push(...after.flatMap((c) => walkNode(c, scope, walk)))
  return { t: 'alert', kind, c: body }
}

const isBlockNode = (node: MdNode): boolean =>
  node.t === 'code' || node.t === 'alert' || (node.t === 'el' && BLOCK.has(node.tag))

const containsBlock = (nodes: readonly MdNode[]): boolean =>
  nodes.some((n) => isBlockNode(n) || ((n.t === 'el' || n.t === 'link' || n.t === 'alert') && containsBlock(n.c)))

const isBlank = (node: MdNode) => node.t === 'text' && node.v.trim() === ''

const isTablePart = (tag: string) => tag === 'table' || tag === 'tr' || TABLE_SECTIONS.has(tag)

/** The `kept` elements of `children`, with each run of `loose` ones wrapped in a `wrapper`; the rest are dropped. */
function wrapLooseRuns(
  children: readonly MdNode[],
  kept: (tag: MdTag) => boolean,
  loose: (tag: MdTag) => boolean,
  wrapper: MdTag,
): MdNode[] {
  const out: MdNode[] = []
  let run: MdNode[] = []
  const flush = () => {
    if (run.length) out.push({ t: 'el', tag: wrapper, c: run })
    run = []
  }
  for (const child of children) {
    if (child.t !== 'el') continue
    if (kept(child.tag)) {
      flush()
      out.push(child)
    } else if (loose(child.tag)) run.push(child)
  }
  flush()
  return out
}

const isRow = (tag: string) => tag === 'tr'
const isCell = (tag: string) => tag === 'td' || tag === 'th'
const isSection = (tag: string) => TABLE_SECTIONS.has(tag)

function tableChildren(tag: MdTag, children: MdNode[]): MdNode[] {
  if (tag === 'tr') return children.filter((c) => c.t === 'el' && isCell(c.tag))
  if (isSection(tag)) return wrapLooseRuns(children, isRow, isCell, 'tr')
  return wrapLooseRuns(children, isSection, isRow, 'tbody')
}

const TABLE_PARENT: Partial<Record<MdTag, (parent: string) => boolean>> = {
  tr: (p) => TABLE_SECTIONS.has(p) || p === 'table',
  td: (p) => p === 'tr' || TABLE_SECTIONS.has(p),
  th: (p) => p === 'tr' || TABLE_SECTIONS.has(p),
  thead: (p) => p === 'table',
  tbody: (p) => p === 'table',
  tfoot: (p) => p === 'table',
}

function straighten(nodes: MdNode[], parent: string): MdNode[] {
  const out: MdNode[] = []
  for (const node of nodes) {
    if (node.t === 'text' || node.t === 'img' || node.t === 'task' || node.t === 'code') {
      out.push(node)
      continue
    }
    if (node.t === 'alert') {
      out.push({ ...node, c: straighten(node.c, 'div') })
      continue
    }
    if (node.t === 'link') {
      out.push({ ...node, c: straighten(node.c, 'a') })
      continue
    }
    const fitsHere = TABLE_PARENT[node.tag]?.(parent) ?? true
    if (!fitsHere) {
      out.push(...straighten(node.c, parent))
      continue
    }
    let tag = node.tag
    if (tag === 'p' && containsBlock(node.c)) tag = 'div'
    let children = straighten(node.c, tag)
    if (isTablePart(tag)) children = tableChildren(tag, children)
    out.push({ ...node, tag, c: children })
  }
  return isTablePart(parent) ? out.filter((n) => !isBlank(n)) : out
}

export async function renderMarkdown(text: string, context: MarkdownContext): Promise<RenderedMarkdown> {
  const { fields, body } = readFrontMatter(text)
  const html = marked.parse(body) as string
  const root = parse(html, {
    comment: false,
    blockTextElements: { script: true, style: true, noscript: true, textarea: true, template: true },
  })
  const walk: Walk = { context, slugger: new GithubSlugger(), codes: [], externalImages: 0 }
  const scope: Scope = {
    depth: 0,
    parent: 'div',
    inLink: false,
    inListItem: false,
    inDefinition: false,
    literal: false,
  }
  const nodes = straighten(walkChildren(root, scope, walk), 'div')
  await Promise.all(
    walk.codes.map(async (pending) => {
      pending.node.code = await highlight(pending.text, pending.lang)
    }),
  )
  return { frontMatter: fields, nodes, externalImages: walk.externalImages }
}
