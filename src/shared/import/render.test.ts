import { describe, expect, it } from 'vitest'
import type { BookBlock, ImageBlock } from './blocks'
import { pageWeight } from './image'
import { escapeAttribute, escapeHtml, type RenderContext, renderBlock, renderBlocks, renderRuns } from './render'

const html = (block: BookBlock) => renderBlock(block)?.html

describe('renderRuns', () => {
  it('escapes text and wraps each styled run in its one element', () => {
    expect(
      renderRuns([
        { text: '<script>&' },
        { text: '"a"', style: 'strong' },
        { br: true },
        { text: 'x<y', style: 'code' },
        { text: '2', style: 'sup' },
        { text: 'i', style: 'sub' },
        { text: 'e', style: 'em' },
      ]),
    ).toBe('&lt;script&gt;&amp;<strong>"a"</strong><br><code>x&lt;y</code><sup>2</sup><sub>i</sub><em>e</em>')
  })
})

describe('renderBlock', () => {
  it('renders every block type in the reader subset', () => {
    expect(html({ type: 'heading', level: 4, runs: [{ text: 'A & B' }] })).toBe('<h4>A &amp; B</h4>')
    expect(html({ type: 'paragraph', runs: [{ text: 'p' }] })).toBe('<p>p</p>')
    expect(html({ type: 'blockquote', paragraphs: [[{ text: 'a' }], [{ text: 'b' }]] })).toBe(
      '<blockquote><p>a</p><p>b</p></blockquote>',
    )
    expect(
      html({
        type: 'list',
        ordered: true,
        items: [
          { runs: [{ text: 'a' }], lists: [{ type: 'list', ordered: false, items: [{ runs: [{ text: 'b' }] }] }] },
        ],
      }),
    ).toBe('<ol><li>a<ul><li>b</li></ul></li></ol>')
    expect(html({ type: 'table', head: [[[{ text: 'h' }]]], body: [[[{ text: 'd' }], [{ text: '<td>' }]]] })).toBe(
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td><td>&lt;td&gt;</td></tr></tbody></table>',
    )
    expect(html({ type: 'table', head: [], body: [[[{ text: 'only body' }]]] })).toBe(
      '<table><tbody><tr><td>only body</td></tr></tbody></table>',
    )
    expect(html({ type: 'code', text: '\n\n\tif (a < b)  \n    go()\n\n' })).toBe(
      '<pre>  if (a &lt; b)\n    go()</pre>',
    )
    expect(html({ type: 'code', text: 'print(1)', lang: 'python' })).toBe('<pre data-lang="python">print(1)</pre>')
  })

  it('weighs code by lines and marks headings', () => {
    expect(renderBlock({ type: 'code', text: 'a\nb\nc' })?.words).toBe(27)
    expect(renderBlock({ type: 'heading', level: 3, runs: [{ text: 'Two words' }] })).toMatchObject({
      words: 2,
      heading: true,
    })
  })

  it('leaves out blocks with no text', () => {
    expect(renderBlock({ type: 'paragraph', runs: [{ text: '  ' }, { br: true }] })).toBeNull()
    expect(renderBlock({ type: 'code', text: '\n \n' })).toBeNull()
    expect(renderBlock({ type: 'list', ordered: false, items: [{ runs: [] }] })).toBeNull()
    expect(
      renderBlocks([
        { type: 'paragraph', runs: [] },
        { type: 'paragraph', runs: [{ text: 'kept' }] },
      ]),
    ).toHaveLength(1)
  })

  it('never lets markup through text, whatever the text is', () => {
    const hostile = '<img src=x onerror=alert(1)><a href="javascript:x">'
    for (const block of [
      { type: 'paragraph', runs: [{ text: hostile }] },
      { type: 'heading', level: 3, runs: [{ text: hostile, style: 'em' }] },
      { type: 'code', text: hostile },
      { type: 'table', head: [], body: [[[{ text: hostile }]]] },
    ] satisfies BookBlock[]) {
      expect(html(block)).not.toMatch(/<(img|a)\b/)
    }
  })
})

describe('figures', () => {
  const context: RenderContext = {
    imageSrc: (n) => `/account/books/x/images/${n}`,
    imageSize: (n) => (n === 1 ? { width: 600, height: 330 } : n === 2 ? { width: 1320, height: 600 } : null),
  }
  const figure = (block: Omit<ImageBlock, 'type'>) => renderBlock({ type: 'image', ...block }, context)

  it('writes the picture as a link to itself, with its size and caption', () => {
    expect(figure({ image: 1, alt: 'A map', caption: [{ text: 'The ' }, { text: 'harbour', style: 'em' }] })).toEqual({
      html:
        '<figure><a href="/account/books/x/images/1"><img src="/account/books/x/images/1" alt="A map" width="600" ' +
        'height="330" loading="lazy" decoding="async"></a><figcaption>The <em>harbour</em></figcaption></figure>',
      words: pageWeight(600, 330) + 2,
      heading: false,
    })
  })

  it('labels the link when the picture has no alt text, and leaves out an empty caption', () => {
    expect(figure({ image: 2, alt: '', caption: [{ text: '  ' }] })?.html).toBe(
      '<figure><a href="/account/books/x/images/2" aria-label="View picture"><img src="/account/books/x/images/2" ' +
        'alt="" width="1320" height="600" loading="lazy" decoding="async"></a></figure>',
    )
  })

  it('shows only the caption of a picture that was left out, and nothing without one', () => {
    expect(figure({ image: 0, alt: 'x', caption: [{ text: 'Figure 3' }] })).toEqual({
      html: '<figure><figcaption>Figure 3</figcaption></figure>',
      words: 2,
      heading: false,
    })
    expect(figure({ image: 9, alt: 'x', caption: [{ text: 'Unknown' }] })?.html).toBe(
      '<figure><figcaption>Unknown</figcaption></figure>',
    )
    expect(figure({ image: 0, alt: 'x' })).toBeNull()
    expect(renderBlock({ type: 'image', image: 1, alt: 'x', caption: [{ text: 'Cap' }] })?.html).toBe(
      '<figure><figcaption>Cap</figcaption></figure>',
    )
  })

  it('escapes attributes, so alt text can never leave its quotes', () => {
    const html = figure({ image: 1, alt: '" onerror="alert(1)" <b>&' })?.html
    expect(html).toContain('alt="&quot; onerror=&quot;alert(1)&quot; &lt;b&gt;&amp;"')
    const hostile: RenderContext = { imageSrc: () => 'javascript:"x"<', imageSize: () => ({ width: 1, height: 1 }) }
    expect(renderBlock({ type: 'image', image: 1, alt: '' }, hostile)?.html).toContain(
      'href="javascript:&quot;x&quot;&lt;"',
    )
    expect(escapeAttribute(`"<>&'`)).toBe(`&quot;&lt;&gt;&amp;'`)
    expect(escapeHtml('"')).toBe('"')
  })

  it('weighs a small, a wide and a tall picture by their shown height', () => {
    const weigh = (width: number, height: number) =>
      renderBlock({ type: 'image', image: 1, alt: '' }, { imageSrc: () => '/p', imageSize: () => ({ width, height }) })
        ?.words
    expect(weigh(40, 40)).toBe(40)
    expect(weigh(1320, 600)).toBe(94)
    expect(weigh(800, 4800)).toBe(176)
  })

  it('renders a chapter with its context', () => {
    const blocks: BookBlock[] = [
      { type: 'paragraph', runs: [{ text: 'p' }] },
      { type: 'image', image: 1, alt: 'A' },
    ]
    expect(renderBlocks(blocks, context).map((b) => b.html)[1]).toContain('<img src="/account/books/x/images/1"')
    expect(renderBlocks(blocks)).toHaveLength(1)
  })
})
