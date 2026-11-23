export const MD_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'blockquote',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'pre',
  'code',
  'kbd',
  'samp',
  'var',
  'strong',
  'b',
  'em',
  'i',
  's',
  'del',
  'ins',
  'sup',
  'sub',
  'q',
  'details',
  'summary',
  'div',
  'span',
] as const

export type MdTag = (typeof MD_TAGS)[number]

const TAG_SET: ReadonlySet<string> = new Set(MD_TAGS)
export const isMdTag = (tag: string): tag is MdTag => TAG_SET.has(tag)

export type MdAlign = 'left' | 'center' | 'right'

export interface MdAttrs {
  id?: string
  title?: string
  align?: MdAlign
  colSpan?: number
  rowSpan?: number
  open?: boolean
  start?: number
}

export type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution'

export type MdLinkTarget =
  | { kind: 'external'; href: string }
  | { kind: 'anchor'; id: string }
  | { kind: 'repo'; path: string; anchor: string | null }

export type MdImageSource = { kind: 'repo'; path: string } | { kind: 'external'; src: string; host: string }

export type MdNode =
  | { t: 'text'; v: string }
  | { t: 'el'; tag: MdTag; attrs?: MdAttrs; c: MdNode[] }
  | { t: 'link'; to: MdLinkTarget; title?: string; c: MdNode[] }
  | {
      t: 'img'
      source: MdImageSource
      alt: string
      title?: string
      width?: number
      height?: number
      align?: MdAlign
    }
  | { t: 'code'; lang: string | null; code: CodeTokens }
  | { t: 'alert'; kind: AlertKind; c: MdNode[] }
  | { t: 'task'; checked: boolean }

export interface FrontMatterField {
  key: string
  value: string
  yaml: boolean
}

export interface RenderedMarkdown {
  frontMatter: FrontMatterField[]
  nodes: MdNode[]
  externalImages: number
}

export interface CodeTokens {
  palette: [string, string][]
  lines: [string, number, number][][]
  highlighted: boolean
}

export const FONT_ITALIC = 1
export const FONT_BOLD = 2
export const FONT_UNDERLINE = 4
export const FONT_STRIKETHROUGH = 8
