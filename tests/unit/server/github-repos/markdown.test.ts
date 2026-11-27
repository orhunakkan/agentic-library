import { describe, expect, it } from 'vitest'
import {
  cleanUrl,
  imageSource,
  linkTarget,
  type MarkdownContext,
  readFrontMatter,
  renderMarkdown,
  resolvePath,
} from '~/server/github-repos/markdown.ts'
import { isMdTag, type MdNode } from '~/shared/github-repos/md-node'
import { XSS_CORPUS } from '../../../fixtures/xss-corpus'

const FILES = new Set(['README.md', 'docs/guide.md', 'docs/img/logo.png', 'assets/badge.svg', 'src/index.ts'])
const FOLDERS = new Set(['docs', 'docs/img', 'assets', 'src'])

const context = (folder = ''): MarkdownContext => ({
  owner: 'Folio-Test',
  name: 'sample',
  folder,
  kindOf: (path) => (FILES.has(path) ? 'file' : FOLDERS.has(path) ? 'folder' : null),
})

const render = async (text: string, folder = '') => (await renderMarkdown(text, context(folder))).nodes

function* all(nodes: readonly MdNode[]): Generator<MdNode> {
  for (const node of nodes) {
    yield node
    if (node.t === 'el' || node.t === 'link' || node.t === 'alert') yield* all(node.c)
  }
}

const text = (nodes: readonly MdNode[]): string =>
  [...all(nodes)]
    .map((n) => (n.t === 'text' ? n.v : ''))
    .join('')
    .trim()

const ATTRS = new Set(['id', 'title', 'align', 'colSpan', 'rowSpan', 'open', 'start'])

function expectSafe(nodes: readonly MdNode[]) {
  for (const node of all(nodes)) {
    if (node.t === 'el') {
      expect(isMdTag(node.tag), node.tag).toBe(true)
      for (const key of Object.keys(node.attrs ?? {})) expect(ATTRS.has(key), key).toBe(true)
    }
    if (node.t === 'link' && node.to.kind === 'external') expect(node.to.href).toMatch(/^(https?|mailto):/)
    if (node.t === 'img' && node.source.kind === 'external') expect(node.source.src).toMatch(/^https:\/\//)
    expect(
      Object.keys(node).every((k) =>
        [
          't',
          'v',
          'tag',
          'attrs',
          'c',
          'to',
          'title',
          'source',
          'alt',
          'width',
          'height',
          'align',
          'lang',
          'code',
          'kind',
          'checked',
        ].includes(k),
      ),
    ).toBe(true)
  }
}

const links = (nodes: readonly MdNode[]) => [...all(nodes)].filter((n) => n.t === 'link')
const images = (nodes: readonly MdNode[]) => [...all(nodes)].filter((n) => n.t === 'img')
const tags = (nodes: readonly MdNode[]) => [...all(nodes)].flatMap((n) => (n.t === 'el' ? [n.tag] : []))

describe('the XSS corpus', () => {
  const corpus = XSS_CORPUS

  it.each(corpus)('%s ends up as nothing that can run', async (_name, payload) => {
    const nodes = await render(payload)
    expectSafe(nodes)
    for (const link of links(nodes)) expect(link.t === 'link' && link.to.kind).not.toBe('external')
    expect(JSON.stringify(nodes)).not.toMatch(/javascript:|vbscript:|onerror|onload|onclick|srcdoc|<script/i)
  })

  it('keeps the text of a link it refuses', async () => {
    const nodes = await render('<a href="javascript:alert(1)">click me</a>')
    expect(links(nodes)).toEqual([])
    expect(text(nodes)).toBe('click me')
  })

  it('drops script, style and iframe together with their content', async () => {
    expect(text(await render('<script>alert(1)</script><style>p{}</style>ok'))).toBe('ok')
  })

  it('keeps the text of an unknown element and loses its tag', async () => {
    const nodes = await render('<x-evil onmouseover="alert(1)">text</x-evil>')
    expect(text(nodes)).toBe('text')
  })

  it('treats a protocol-relative link as an external one', async () => {
    const [link] = links(await render('<a href="//evil.example/x">x</a>'))
    expect(link).toMatchObject({ to: { kind: 'external', href: 'https://evil.example/x' } })
  })

  it('treats backslashes as a browser does', async () => {
    const [link] = links(await render('<a href="\\\\evil.example">x</a>'))
    expect(link).toMatchObject({ to: { kind: 'external', href: 'https://evil.example/' } })
  })
})

describe('GFM', () => {
  it('renders tables with their alignment', async () => {
    const nodes = await render('| a | b |\n|:-:|--:|\n| 1 | 2 |\n')
    expect(tags(nodes)).toEqual(['table', 'thead', 'tr', 'th', 'th', 'tbody', 'tr', 'td', 'td'])
    const th = [...all(nodes)].find((n) => n.t === 'el' && n.tag === 'th')
    expect(th).toMatchObject({ attrs: { align: 'center' } })
  })

  it('renders task lists as checkboxes', async () => {
    const nodes = await render('- [x] done\n- [ ] todo\n')
    expect([...all(nodes)].filter((n) => n.t === 'task')).toEqual([
      { t: 'task', checked: true },
      { t: 'task', checked: false },
    ])
    expect(text(nodes)).toContain('done')
  })

  it('renders a loose task list', async () => {
    const nodes = await render('- [x] done\n\n- [ ] todo\n')
    expect([...all(nodes)].filter((n) => n.t === 'task')).toHaveLength(2)
  })

  it('renders strikethrough', async () => {
    expect(tags(await render('~~gone~~'))).toContain('del')
  })
})

describe('front matter', () => {
  it('reads the agent-skills SKILL.md shape as fields above the body', async () => {
    const skill = [
      '---',
      'name: accessibility-engineering',
      'description: Audits existing interfaces for WCAG 2.2 AA conformance.',
      '---',
      '',
      '# Accessibility Engineering',
    ].join('\n')
    const rendered = await renderMarkdown(skill, context())
    expect(rendered.frontMatter).toEqual([
      { key: 'name', value: 'accessibility-engineering', yaml: false },
      { key: 'description', value: 'Audits existing interfaces for WCAG 2.2 AA conformance.', yaml: false },
    ])
    expect(tags(rendered.nodes)).toEqual(['h1'])
  })

  it('keeps a value that is not one line as its YAML text', () => {
    const { fields } = readFrontMatter('---\ntags:\n  - a\n  - b\ntitle: "Quoted"\nsummary: >\n  folded\n---\nbody')
    expect(fields).toEqual([
      { key: 'tags', value: '  - a\n  - b', yaml: true },
      { key: 'title', value: 'Quoted', yaml: false },
      { key: 'summary', value: '>\n  folded', yaml: true },
    ])
  })

  it('leaves a file without front matter as it is', () => {
    expect(readFrontMatter('# Hi\n---\n')).toEqual({ fields: [], body: '# Hi\n---\n' })
  })
})

describe('alerts', () => {
  it.each(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'])('%s', async (kind) => {
    const [alert, ...rest] = (await render(`> [!${kind}]\n> Useful information.\n`)).filter((n) => n.t !== 'text')
    expect(rest).toEqual([])
    expect(alert).toMatchObject({ t: 'alert', kind: kind.toLowerCase() })
    expect(alert?.t === 'alert' && alert.c.filter((n) => n.t !== 'text')).toEqual([
      { t: 'el', tag: 'p', c: [{ t: 'text', v: 'Useful information.' }] },
    ])
  })

  it('takes the marker on a line of its own, followed by paragraphs', async () => {
    const [alert] = (await render('> [!tip]\n>\n> First.\n>\n> Second.\n')).filter((n) => n.t === 'alert')
    expect(alert?.t === 'alert' && text(alert.c)).toBe('First.\nSecond.')
  })

  it('leaves a blockquote without the marker as a blockquote', async () => {
    expect(tags(await render('> [!NOTE] not on its own line\n'))).toEqual(['blockquote', 'p'])
    expect(tags(await render('> plain\n'))).toEqual(['blockquote', 'p'])
  })
})

describe('heading anchors', () => {
  it('gives GitHub slugs, prefixed user-content-', async () => {
    const nodes = await render(
      '# Hello, World!\n## Café & Crème\n## Hello, World!\n## Hello, World!\n### `code` bits\n',
    )
    const ids = [...all(nodes)].flatMap((n) => (n.t === 'el' && n.attrs?.id ? [n.attrs.id] : []))
    expect(ids).toEqual([
      'user-content-hello-world',
      'user-content-café--crème',
      'user-content-hello-world-1',
      'user-content-hello-world-2',
      'user-content-code-bits',
    ])
  })

  it('points a fragment link at the heading', async () => {
    const [link] = links(await render('[Go](#hello-world)'))
    expect(link).toMatchObject({ to: { kind: 'anchor', id: 'user-content-hello-world' } })
  })

  it('makes a heading inside a heading a span, as the parser would close it', async () => {
    expect(tags(await render('<h1>a<h2>b</h2></h1>'))).toEqual(['h1', 'span'])
  })
})

describe('emoji', () => {
  it('replaces shortcodes outside code', async () => {
    expect(text(await render('Ship it :rocket: :+1: :not_an_emoji:'))).toBe('Ship it 🚀 👍 :not_an_emoji:')
  })

  it('leaves shortcodes inside code alone', async () => {
    const nodes = await render('`:rocket:`\n\n<kbd>:rocket:</kbd>')
    expect(text(nodes)).toBe(':rocket:\n:rocket:')
  })
})

describe('fenced code', () => {
  it('is highlighted in the language its info string names', async () => {
    const [code] = (await render('```ts\nconst a: number = 1\n```\n')).filter((n) => n.t === 'code')
    expect(code).toMatchObject({ t: 'code', lang: 'ts', code: { highlighted: true } })
    expect(code?.t === 'code' && code.code.lines[0]?.map((r) => r[0]).join('')).toBe('const a: number = 1')
  })

  it('is plain text without a language, or with mermaid kept as a code block', async () => {
    const [plain] = (await render('```\n<b>x</b>\n```\n')).filter((n) => n.t === 'code')
    expect(plain).toMatchObject({ lang: null, code: { highlighted: false, lines: [[['<b>x</b>', 0, 0]]] } })
    const [mermaid] = (await render('```mermaid\ngraph TD\n```\n')).filter((n) => n.t === 'code')
    expect(mermaid).toMatchObject({ t: 'code', lang: 'mermaid' })
  })

  it('keeps a raw <pre> without code as a pre', async () => {
    expect(tags(await render('<pre>a <b>b</b></pre>'))).toEqual(['pre', 'b'])
  })
})

describe('links', () => {
  it('resolves a relative link in the tree to a link inside Folio, with its fragment', async () => {
    const [link] = links(await render('[Guide](docs/guide.md#install)'))
    expect(link).toMatchObject({ to: { kind: 'repo', path: 'docs/guide.md', anchor: 'user-content-install' } })
  })

  it('resolves against the file’s folder, and from the root with a leading slash', async () => {
    const [up] = links(await render('[Up](../README.md)', 'docs'))
    expect(up).toMatchObject({ to: { kind: 'repo', path: 'README.md', anchor: null } })
    const [root] = links(await render('[Src](/src/index.ts?plain=1)', 'docs'))
    expect(root).toMatchObject({ to: { kind: 'repo', path: 'src/index.ts' } })
    const [folder] = links(await render('[Docs](./docs/)'))
    expect(folder).toMatchObject({ to: { kind: 'repo', path: 'docs' } })
  })

  it('takes the link away from a path that climbs above the root, keeping its text', async () => {
    const nodes = await render('[Wiki](../../wiki)', 'docs')
    expect(links(nodes)).toEqual([])
    expect(text(nodes)).toBe('Wiki')
  })

  it('opens https, http and mailto links as external ones', async () => {
    const nodes = await render('[a](https://example.com/x) [b](http://example.com) [c](mailto:me@example.com)')
    expect(links(nodes).map((l) => l.t === 'link' && l.to)).toEqual([
      { kind: 'external', href: 'https://example.com/x' },
      { kind: 'external', href: 'http://example.com/' },
      { kind: 'external', href: 'mailto:me@example.com' },
    ])
  })

  it('refuses other schemes and a bare fragment', async () => {
    expect(links(await render('[a](ftp://example.com) [b](#) [c](tel:123)'))).toEqual([])
  })

  it('unwraps a link inside a link', async () => {
    const nodes = await render('<a href="https://a.example">one <a href="https://b.example">two</a></a>')
    expect(links(nodes).length).toBeLessThanOrEqual(2)
    for (const link of links(nodes)) if (link.t === 'link') expect(links(link.c)).toEqual([])
  })
})

describe('pictures', () => {
  it('serves a relative picture from the repository', async () => {
    const [image] = images(await render('![Logo](img/logo.png "The logo")', 'docs'))
    expect(image).toEqual({
      t: 'img',
      source: { kind: 'repo', path: 'docs/img/logo.png' },
      alt: 'Logo',
      title: 'The logo',
    })
  })

  it.each([
    ['the raw host', 'https://raw.githubusercontent.com/folio-test/sample/main/docs/img/logo.png'],
    [
      'the raw host, a ref with a slash',
      'https://raw.githubusercontent.com/folio-test/sample/feature/x/docs/img/logo.png',
    ],
    ['github.com /raw/', 'https://github.com/Folio-Test/sample/raw/main/docs/img/logo.png'],
    ['github.com /blob/ ?raw=true', 'https://github.com/folio-test/sample/blob/v1.0/docs/img/logo.png?raw=true'],
  ])('serves this repository’s picture by %s', async (_name, src) => {
    const [image] = images(await render(`![Logo](${src})`))
    expect(image).toMatchObject({ source: { kind: 'repo', path: 'docs/img/logo.png' } })
  })

  it('shows a badge from another site as an external picture, and counts it', async () => {
    const rendered = await renderMarkdown(
      '![CI](https://img.shields.io/badge/ci-passing-green) ![x](https://github.com/user-attachments/assets/1)',
      context(),
    )
    expect(rendered.externalImages).toBe(2)
    expect(images(rendered.nodes)[0]).toMatchObject({
      source: { kind: 'external', src: 'https://img.shields.io/badge/ci-passing-green', host: 'img.shields.io' },
    })
  })

  it('treats another repository’s raw picture as external', async () => {
    const [image] = images(await render('![x](https://raw.githubusercontent.com/other/repo/main/docs/img/logo.png)'))
    expect(image).toMatchObject({ source: { kind: 'external' } })
  })

  it('drops data: and http: pictures for their alt text', async () => {
    const nodes = await render('![one](data:image/png;base64,AAAA) ![two](http://example.com/x.png)')
    expect(images(nodes)).toEqual([])
    expect(text(nodes)).toBe('one two')
  })

  it('keeps width and height of up to four digits, and align', async () => {
    const [image] = images(await render('<img src="assets/badge.svg" width="250" height="99999" align="right" alt="">'))
    expect(image).toEqual({
      t: 'img',
      source: { kind: 'repo', path: 'assets/badge.svg' },
      alt: '',
      width: 250,
      align: 'right',
    })
  })
})

describe('HTML GitHub keeps', () => {
  it('keeps <details> open and its summary, and makes the paragraph around it a div', async () => {
    const nodes = await render('Before <details open><summary>More</summary>Hidden</details>')
    expect(tags(nodes)).toEqual(['div', 'details', 'summary'])
    expect([...all(nodes)].find((n) => n.t === 'el' && n.tag === 'details')).toMatchObject({ attrs: { open: true } })
  })

  it('keeps only the <img> of a <picture>', async () => {
    const nodes = await render(
      '<picture><source media="(prefers-color-scheme: dark)" srcset="dark.png"><img src="assets/badge.svg" alt="Badge"></picture>',
    )
    expect(images(nodes)).toEqual([{ t: 'img', source: { kind: 'repo', path: 'assets/badge.svg' }, alt: 'Badge' }])
  })

  it('keeps align on a centred block, and drops classes and ids', async () => {
    const nodes = await render('<div align="center" class="x" id="y"><h1 align="CENTER">Title</h1></div>')
    expect(nodes[0]).toMatchObject({ t: 'el', tag: 'div', attrs: { align: 'center' } })
    expect([...all(nodes)].find((n) => n.t === 'el' && n.tag === 'h1')).toMatchObject({
      attrs: { align: 'center', id: 'user-content-title' },
    })
  })

  it('keeps spans of 1 to 100 and an ordered list’s start', async () => {
    const nodes = await render(
      '<table><tr><td colspan="2" rowspan="101">a</td></tr></table>\n\n<ol start="3"><li>c</li></ol>',
    )
    expect([...all(nodes)].find((n) => n.t === 'el' && n.tag === 'td')).toMatchObject({ attrs: { colSpan: 2 } })
    expect([...all(nodes)].find((n) => n.t === 'el' && n.tag === 'ol')).toMatchObject({ attrs: { start: 3 } })
  })

  it('puts the rows of a table written without a tbody into one, and drops stray text', async () => {
    const nodes = await render('<table>stray<tr><td>a</td>x</tr></table>')
    expect(tags(nodes)).toEqual(['table', 'tbody', 'tr', 'td'])
  })

  it('unwraps table parts outside a table', async () => {
    expect(tags(await render('<td>cell</td>'))).not.toContain('td')
  })

  it('keeps only the text of elements nested too deep', async () => {
    const deep = `${'<div>'.repeat(100)}deep${'</div>'.repeat(100)}`
    const nodes = await render(deep)
    expect(tags(nodes).length).toBeLessThan(50)
    expect(text(nodes)).toBe('deep')
  })
})

describe('the path and URL helpers', () => {
  it('resolvePath', () => {
    expect(resolvePath('docs', 'guide.md')).toBe('docs/guide.md')
    expect(resolvePath('docs/a', '../../x')).toBe('x')
    expect(resolvePath('docs', '../../x')).toBeNull()
    expect(resolvePath('docs', '/x/./y')).toBe('x/y')
  })

  it('cleanUrl', () => {
    expect(cleanUrl(' \u0001https://x\t.example ')).toBe('https://x.example')
    expect(cleanUrl('java\u0000script:')).toBeNull()
  })

  it('linkTarget refuses an address it cannot read', () => {
    expect(linkTarget('https://[bad', '')).toBeNull()
    expect(linkTarget('%E0%A4%A', '')).toBeNull()
  })

  it('imageSource refuses an empty path and one above the root', () => {
    expect(imageSource('?x=1', context())).toBeNull()
    expect(imageSource('../x.png', context())).toBeNull()
  })
})

describe('the rest of the walker', () => {
  it('nests definition lists, and makes a dt inside a dt a div', async () => {
    const nodes = await render(
      '<dl><dt>Term<span><dt>inner</dt></span></dt><dd>Means <dl><dd>nested</dd></dl></dd></dl>',
    )
    expect(tags(nodes)).toEqual(['dl', 'dt', 'span', 'div', 'dd', 'dl', 'dd'])
  })

  it('makes a list item straight inside another a div', async () => {
    expect(tags(await render('<ul><li>one<span><li>two</li></span></li></ul>'))).toEqual(['ul', 'li', 'span', 'div'])
  })

  it('keeps a link’s and an element’s title, a picture’s height, and a row span', async () => {
    const nodes = await render(
      '<p title="Para"><a href="https://x.example" title="X">x</a> <img src="a.png" height="20" title="Pic" alt="">' +
        '</p><table><tr><td rowspan="3">a</td></tr></table>',
    )
    expect(nodes[0]).toMatchObject({ t: 'el', tag: 'p', attrs: { title: 'Para' } })
    expect(links(nodes)[0]).toMatchObject({ title: 'X' })
    expect(images(nodes)[0]).toMatchObject({ height: 20, title: 'Pic' })
    expect([...all(nodes)].find((n) => n.t === 'el' && n.tag === 'td')).toMatchObject({ attrs: { rowSpan: 3 } })
  })

  it('drops a picture without a source, keeping its alt text', async () => {
    expect(text(await render('<img alt="Nothing"> <img>'))).toBe('Nothing')
  })

  it('ignores an ordered list’s start that isn’t a number', async () => {
    expect([...all(await render('<ol start="x"><li>a</li></ol>'))][0]).not.toHaveProperty('attrs')
  })

  it('reads a blockquote that starts with something other than a paragraph as a blockquote', async () => {
    expect(tags(await render('<blockquote><div>[!NOTE]</div></blockquote>'))).toEqual(['blockquote', 'div'])
    expect(tags(await render('<blockquote><p><em>[!NOTE]</em></p></blockquote>'))).toEqual(['blockquote', 'p', 'em'])
    expect(tags(await render('<blockquote>\n</blockquote>'))).toEqual(['blockquote'])
  })

  it('drops the line break after an alert’s marker', async () => {
    const [alert] = (await render('<blockquote><p>[!WARNING]<br>Careful.</p></blockquote>')).filter(
      (n) => n.t === 'alert',
    )
    expect(alert?.t === 'alert' && alert.c[0]).toEqual({ t: 'el', tag: 'p', c: [{ t: 'text', v: 'Careful.' }] })
  })

  it('puts loose cells in a section into a row, beside real rows', async () => {
    const nodes = await render('<table><tbody><td>a</td><th>b</th><tr><td>c</td></tr>x<span>y</span></tbody></table>')
    expect(tags(nodes)).toEqual(['table', 'tbody', 'tr', 'td', 'th', 'tr', 'td'])
  })

  it('keeps a footer in a table, and unwraps one outside it', async () => {
    expect(tags(await render('<table><tfoot><tr><td>f</td></tr></tfoot></table>'))).toEqual([
      'table',
      'tfoot',
      'tr',
      'td',
    ])
    expect(tags(await render('<div><tfoot>f</tfoot></div>'))).toEqual(['div'])
  })

  it('keeps a table’s sections in order, gathering the rows between them', async () => {
    const nodes = await render('<table><tr><td>a</td></tr><thead><tr><th>h</th></tr></thead><p>no</p></table>')
    expect(tags(nodes)).toEqual(['table', 'tbody', 'tr', 'td', 'thead', 'tr', 'th'])
  })

  it('resolves a fragment that isn’t encoded properly as it is', () => {
    expect(linkTarget('#%E0%A4%A', '')).toEqual({ kind: 'anchor', id: 'user-content-%E0%A4%A' })
  })

  it('refuses a picture address with a control character, and keeps an odd raw address external', () => {
    expect(imageSource('a\u0001b.png', context())).toBeNull()
    expect(imageSource('https://raw.githubusercontent.com/folio-test/sample/main/%E0%A4%A', context())).toMatchObject({
      kind: 'external',
    })
    expect(imageSource('https://raw.githubusercontent.com/folio-test/sample/main/nope.png', context())).toMatchObject({
      kind: 'external',
    })
    expect(imageSource('https://github.com/folio-test/sample/raw/main/nope.png', context())).toMatchObject({
      kind: 'external',
    })
  })

  it('reads front matter with blank lines and indented lines before any key', () => {
    expect(readFrontMatter('---\n  stray\n\nkey: value\n\n---\nbody').fields).toEqual([
      { key: 'key', value: 'value', yaml: false },
    ])
  })
})

describe('a whole README', () => {
  /** A README that uses most of what the renderer handles, so a change to any of it shows in one reviewable diff. */
  const README = [
    '---',
    'name: sample',
    'description: A repository Folio renders.',
    '---',
    '',
    '# Sample :rocket:',
    '',
    '![logo](docs/img/logo.png) ![badge](https://img.shields.io/badge/ok-green)',
    '',
    'Read the [guide](docs/guide.md#install), the [code](./src/index.ts) or [the web](https://example.com).',
    '',
    '> [!NOTE]',
    '> Useful information.',
    '',
    '## Steps',
    '',
    '1. First',
    '2. Second',
    '',
    '- [x] done',
    '- [ ] todo',
    '',
    '| Left | Centre |',
    '| :--- | :----: |',
    '| a    | ~~b~~  |',
    '',
    '```ts',
    'const answer: number = 42',
    '```',
    '',
    '<details><summary>More</summary>Hidden <script>alert(1)</script>text.</details>',
    '',
  ].join('\n')

  it('renders the same tree as the snapshot; review its diff when the renderer changes on purpose', async () => {
    const rendered = await renderMarkdown(README, context())
    await expect(`${JSON.stringify(rendered, null, 2)}\n`).toMatchFileSnapshot('./__snapshots__/readme.json')
  })
})
