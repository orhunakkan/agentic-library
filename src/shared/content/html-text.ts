const ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
])

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code.startsWith('#')) {
      const n = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1))
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES.get(code.toLowerCase()) ?? m
  })
}

export function htmlParagraphs(html: string): string[] {
  return html
    .split(/<\/(?:p|h3|h4|li|blockquote|pre|th|td)>/i)
    .map((chunk) => decodeEntities(chunk.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).trim())
    .filter(Boolean)
}

interface Element {
  tag: string
  children: Node[]
}
type Node = Element | string

const VOID = new Set(['br'])

function parse(html: string): Node[] {
  const root: Element = { tag: '', children: [] }
  const stack: Element[] = [root]
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>|([^<]+|<)/gi)) {
    const top = stack.at(-1) as Element
    if (m[3] !== undefined) {
      top.children.push(decodeEntities(m[3]))
      continue
    }
    const tag = (m[2] as string).toLowerCase()
    if (m[1]) {
      const at = stack.findLastIndex((e) => e.tag === tag)
      if (at > 0) stack.length = at
    } else if (VOID.has(tag)) {
      top.children.push({ tag, children: [] })
    } else {
      const el: Element = { tag, children: [] }
      top.children.push(el)
      stack.push(el)
    }
  }
  return root.children
}

function inline(nodes: readonly Node[]): string {
  let out = ''
  for (const node of nodes) {
    if (typeof node === 'string') out += node
    else if (node.tag === 'br') out += '\n'
    else if (node.tag === 'code') out += `\`${inline(node.children)}\``
    else if (node.tag === 'ul' || node.tag === 'ol') out += `\n${list(node, 1)}`
    else out += inline(node.children)
  }
  return out
}

const tidy = (text: string) =>
  text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

function list(el: Element, depth: number): string {
  const indent = '  '.repeat(depth - 1)
  const items = el.children.filter((c): c is Element => typeof c !== 'string' && c.tag === 'li')
  return items
    .map((li, i) => {
      const marker = el.tag === 'ol' ? `${i + 1}.` : '-'
      const nested = li.children.filter(
        (c): c is Element => typeof c !== 'string' && (c.tag === 'ul' || c.tag === 'ol'),
      )
      const own = tidy(inline(li.children.filter((c) => !nested.includes(c as Element)))).replace(
        /\n/g,
        `\n${indent}  `,
      )
      return [`${indent}${marker} ${own}`, ...nested.map((n) => list(n, depth + 1))].join('\n')
    })
    .join('\n')
}

function rows(el: Element): string[] {
  const out: string[] = []
  for (const child of el.children) {
    if (typeof child === 'string') continue
    if (child.tag === 'tr') {
      const cells = child.children.filter(
        (c): c is Element => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th'),
      )
      out.push(cells.map((c) => tidy(inline(c.children)).replace(/\s*\n\s*/g, ' ')).join('\t'))
    } else out.push(...rows(child))
  }
  return out
}

function blockText(node: Node): string {
  if (typeof node === 'string') return tidy(node)
  switch (node.tag) {
    case 'pre': {
      const code = node.children.map((c) => (typeof c === 'string' ? c : inline(c.children))).join('')
      return `\`\`\`\n${code.replace(/\s+$/, '')}\n\`\`\``
    }
    case 'ul':
    case 'ol':
      return list(node, 1)
    case 'table':
      return rows(node).join('\n')
    case 'blockquote': {
      const parts = node.children.some((c) => typeof c !== 'string' && c.tag === 'p')
        ? node.children.map((c) => tidy(typeof c === 'string' ? c : inline(c.children))).filter(Boolean)
        : [tidy(inline(node.children))]
      return parts.map((p) => p.replace(/^/gm, '> ')).join('\n>\n')
    }
    default:
      return tidy(inline(node.children))
  }
}

export function htmlTextBlocks(html: string): string[] {
  const blocks: string[] = []
  let heading = ''
  for (const node of parse(html)) {
    const text = blockText(node)
    if (!text) continue
    if (typeof node !== 'string' && (node.tag === 'h3' || node.tag === 'h4')) {
      heading = heading ? `${heading}\n${text}` : text
      continue
    }
    blocks.push(heading ? `${heading}\n\n${text}` : text)
    heading = ''
  }
  if (heading) blocks.push(heading)
  return blocks
}
