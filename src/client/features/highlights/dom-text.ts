export interface NodePoint {
  index: number
  offset: number
}

export function locate(lengths: readonly number[], offset: number, side: 'start' | 'end'): NodePoint | null {
  let before = 0
  let last: NodePoint | null = null
  for (const [index, length] of lengths.entries()) {
    if (length === 0) continue
    const end = before + length
    if (side === 'start' ? offset < end : offset <= end) return { index, offset: Math.max(0, offset - before) }
    last = { index, offset: length }
    before = end
  }
  return last
}

export function offsetOf(lengths: readonly number[], index: number, offset: number): number {
  let before = 0
  for (let i = 0; i < index; i++) before += lengths[i] ?? 0
  return before + Math.min(Math.max(0, offset), lengths[index] ?? 0)
}

export function trimSpan(text: string, start: number, end: number): { start: number; end: number } | null {
  let s = start
  let e = end
  while (s < e && /\s/.test(text[s] ?? '')) s++
  while (e > s && /\s/.test(text[e - 1] ?? '')) e--
  return e > s ? { start: s, end: e } : null
}

function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('[data-highlight-skip]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
  return nodes
}

export interface PageText {
  root: HTMLElement
  nodes: Text[]
  lengths: number[]
  text: string
}

export function readPage(root: HTMLElement): PageText {
  const nodes = textNodes(root)
  return { root, nodes, lengths: nodes.map((n) => n.data.length), text: nodes.map((n) => n.data).join('') }
}

export function rangeFor(page: PageText, start: number, end: number): Range | null {
  if (end <= start || end > page.text.length) return null
  const a = locate(page.lengths, start, 'start')
  const b = locate(page.lengths, end, 'end')
  const startNode = a && page.nodes[a.index]
  const endNode = b && page.nodes[b.index]
  if (!a || !b || !startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, a.offset)
  range.setEnd(endNode, b.offset)
  return range
}

function boundaryOffset(page: PageText, container: Node, offset: number): number {
  if (!page.root.contains(container)) {
    const where = page.root.compareDocumentPosition(container)
    return where & Node.DOCUMENT_POSITION_PRECEDING ? 0 : page.text.length
  }
  const index = page.nodes.indexOf(container as Text)
  if (index >= 0) return offsetOf(page.lengths, index, offset)
  const point = document.createRange()
  point.setStart(container, offset)
  let before = 0
  for (const [i, node] of page.nodes.entries()) {
    if (point.comparePoint(node, 0) >= 0) break
    before += page.lengths[i] ?? 0
  }
  return before
}

export function spanOf(page: PageText, range: Range): { start: number; end: number } | null {
  const start = boundaryOffset(page, range.startContainer, range.startOffset)
  const end = boundaryOffset(page, range.endContainer, range.endOffset)
  return trimSpan(page.text, start, end)
}
