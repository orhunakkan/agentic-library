import { describe, expect, it } from 'vitest'
import { type HtmlItem, type PictureLookup, parseHtml, type WalkOptions, walkHtml } from './html'
import { renderBlock, renderRuns } from './render'

function sanitise(html: string): string {
  const items: HtmlItem[] = []
  walkHtml(parseHtml(html), items)
  return items
    .map((item) =>
      item.kind === 'heading'
        ? `<h${item.level}>${renderRuns(item.runs)}</h${item.level}>`
        : (renderBlock(item.block)?.html ?? ''),
    )
    .join('')
}

describe('walkHtml: the reader subset survives', () => {
  it('keeps headings with their level and plain title', () => {
    const items: HtmlItem[] = []
    walkHtml(parseHtml('<h2>The <em>long</em>  road</h2>'), items)
    expect(items).toEqual([
      {
        kind: 'heading',
        level: 2,
        title: 'The long road',
        runs: [{ text: 'The ' }, { text: 'long', style: 'em' }, { text: ' road' }],
      },
    ])
  })

  it('keeps paragraphs with emphasis, code, sup and sub inline', () => {
    expect(
      sanitise(
        '<p><b>Bold</b> <i>it</i> <strong>s</strong> <em>e</em> <code>x()</code> H<sub>2</sub>O x<sup>2</sup></p>',
      ),
    ).toBe(
      '<p><strong>Bold</strong> <em>it</em> <strong>s</strong> <em>e</em> <code>x()</code> H<sub>2</sub>O x<sup>2</sup></p>',
    )
  })

  it('keeps quotes, lists (nested too), tables and code listings', () => {
    expect(sanitise('<blockquote><p>One</p><p>Two</p></blockquote>')).toBe(
      '<blockquote><p>One</p><p>Two</p></blockquote>',
    )
    expect(
      sanitise(
        '<blockquote><header><p>Hunsford,</p><p>15th October</p></header><p>Dear Sir,</p><footer><p>William Collins.</p></footer></blockquote>',
      ),
    ).toBe('<blockquote><p>Hunsford,</p><p>15th October</p><p>Dear Sir,</p><p>William Collins.</p></blockquote>')
    expect(sanitise('<ol><li>a<ul><li>b</li></ul></li><li>c</li></ol>')).toBe(
      '<ol><li>a<ul><li>b</li></ul></li><li>c</li></ol>',
    )
    expect(sanitise('<table><thead><tr><th>K</th></tr></thead><tbody><tr><td>V</td></tr></tbody></table>')).toContain(
      '<thead><tr><th>K</th></tr></thead><tbody><tr><td>V</td></tr></tbody>',
    )
    expect(sanitise('<pre>if (a &lt; b) {\n  go()\n}</pre>')).toContain('if (a &lt; b) {\n  go()\n}')
  })

  it('leaves out the empty spacer rows some Markdown tables have', () => {
    expect(sanitise('<table><tr><td> </td><td></td></tr><tr><td>V</td><td>W</td></tr></table>')).toBe(
      '<table><tbody><tr><td>V</td><td>W</td></tr></tbody></table>',
    )
  })

  it('walks into wrappers it does not know, in document order', () => {
    expect(sanitise('<section><div><p>One</p></div><article><p>Two</p></article></section>')).toBe(
      '<p>One</p><p>Two</p>',
    )
  })
})

describe('walkHtml: everything else is removed', () => {
  it('unwraps links and spans to their text, so no href survives', () => {
    expect(sanitise('<p>See <a href="https://example.com">the <span class="x">site</span></a>.</p>')).toBe(
      '<p>See the site.</p>',
    )
  })

  it.each([
    ['script', '<p>Before</p><script>window.__pwned = true</script><p>After</p>'],
    ['inline script', '<p>Before<script>window.__pwned = true</script> after</p>'],
    ['style', '<style>p { color: red }</style><p>Before<style>body{display:none}</style> after</p>'],
    ['img', '<p>Before<img src="x" onerror="window.__pwned = true"/> after</p>'],
    ['figure', '<figure><img src="x"/><figcaption>Caption</figcaption></figure><p>Before after</p>'],
    ['svg', '<p>Before<svg onload="window.__pwned = true"><text>Drawn</text></svg> after</p>'],
    ['iframe', '<p>Before<iframe src="https://evil.example">Fallback</iframe> after</p>'],
    ['block iframe', '<iframe src="https://evil.example"><p>Fallback</p></iframe><p>Before after</p>'],
    ['object', '<p>Before<object data="evil.swf"><param name="a" value="b"/>Fallback</object> after</p>'],
    ['embed', '<p>Before<embed src="evil.swf"/> after</p>'],
    ['noscript', '<p>Before<noscript><p>Enable scripts</p></noscript> after</p>'],
  ])('drops %s with its content', (_name, html) => {
    const out = sanitise(html)
    expect(out).not.toMatch(/pwned|Fallback|Caption|Drawn|Enable scripts|color|display|evil/)
    expect(out).not.toMatch(/<(script|style|img|figure|svg|iframe|object|embed|noscript|param)\b/)
    expect(out).toContain('Before')
  })

  it('never lets an event handler or a javascript: URL through', () => {
    const out = sanitise(
      '<p onclick="window.__pwned = true">Safe <a href="javascript:window.__pwned=true">link text</a> ' +
        '<em onmouseover="x()">em</em> <code onfocus="y()">c</code></p><blockquote onload="z()"><p>q</p></blockquote>',
    )
    expect(out).toBe('<p>Safe link text <em>em</em> <code>c</code></p><blockquote><p>q</p></blockquote>')
    expect(out).not.toMatch(/\son\w+=|javascript:/i)
  })

  it('keeps escaped markup as text, so it can never become an element', () => {
    expect(sanitise('<p>Safe &lt;b&gt;not bold&lt;/b&gt;.</p>')).toBe('<p>Safe &lt;b&gt;not bold&lt;/b&gt;.</p>')
    expect(sanitise('<p><code>&lt;script&gt;</code></p>')).toBe('<p><code>&lt;script&gt;</code></p>')
  })

  it('reads the hostile chapter of the import fixture as plain, safe text', () => {
    const hostile =
      '<script>window.__pwned = true</script><p><img src="x" onerror="window.__pwned = true"/>Safe ' +
      '<a href="javascript:window.__pwned=true">link text</a> &lt;b&gt;not bold&lt;/b&gt;.</p>'
    expect(sanitise(hostile)).toBe('<p>Safe link text &lt;b&gt;not bold&lt;/b&gt;.</p>')
  })

  it('drops comments, and blocks with no text', () => {
    expect(sanitise('<!-- secret --><p>  </p><p><em> </em></p><ul><li></li></ul><p>Kept</p>')).toBe('<p>Kept</p>')
  })
})

describe('walkHtml: whitespace', () => {
  it('collapses runs of whitespace and trims each block', () => {
    expect(sanitise('<p>\n   Many\t\t  spaces\n\n here   </p>')).toBe('<p>Many spaces here</p>')
  })

  it('trims leading and trailing line breaks but keeps inner ones', () => {
    expect(sanitise('<p><br/> one<br/>two <br/></p>')).toBe('<p>one<br>two</p>')
  })

  it('collapses whitespace in inline code, which is not a listing', () => {
    expect(sanitise('<p>Call <code>a(\n    b)</code></p>')).toBe('<p>Call <code>a( b)</code></p>')
  })

  it('keeps whitespace inside code listings', () => {
    expect(sanitise('<pre>  a\n    b</pre>')).toContain('  a\n    b')
  })
})

describe('walkHtml: pictures', () => {
  function lookup(sizes: Record<string, { width: number; height: number } | null> = {}) {
    const keys: string[] = []
    const svgs: string[] = []
    const number = (key: string) => {
      if (!keys.includes(key)) keys.push(key)
      return keys.indexOf(key) + 1
    }
    const pictures: PictureLookup = {
      file: (src) => number(src),
      svg: (text) => {
        svgs.push(text)
        return number(`svg:${text}`)
      },
      size: (n) => sizes[keys[n - 1] ?? ''] ?? (keys[n - 1]?.startsWith('svg:') ? null : { width: 600, height: 400 }),
    }
    return { pictures, keys, svgs }
  }
  const blocks = (html: string, options: WalkOptions) => {
    const items: HtmlItem[] = []
    walkHtml(parseHtml(html), items, options)
    return items.map((item) => (item.kind === 'block' ? item.block : { heading: item.title }))
  }

  it('reads an img and a figure with its caption', () => {
    const { pictures, keys } = lookup()
    expect(
      blocks(
        '<img src="a.png" alt=" A  map "/><figure><img src="../b.jpg"/><figcaption>The <i>bay</i></figcaption></figure>',
        { pictures },
      ),
    ).toEqual([
      { type: 'image', image: 1, alt: 'A map' },
      { type: 'image', image: 2, alt: '', caption: [{ text: 'The ' }, { text: 'bay', style: 'em' }] },
    ])
    expect(keys).toEqual(['a.png', '../b.jpg'])
  })

  it('reads an svg that frames one image by its href or xlink:href', () => {
    const { pictures, keys } = lookup()
    blocks(
      '<svg viewBox="0 0 10 10"><title>Plate 1</title><image href="p1.jpg"/></svg>' +
        '<div><svg><g><image xlink:href="p2.png" width="5"/></g></svg></div>',
      { pictures },
    )
    expect(keys).toEqual(['p1.jpg', 'p2.png'])
    expect(blocks('<svg aria-label="Plate"><image href="p1.jpg"/></svg>', { pictures })).toEqual([
      { type: 'image', image: 1, alt: 'Plate' },
    ])
  })

  it('serialises an inline diagram as an SVG document with its namespaces', () => {
    const { pictures, svgs } = lookup()
    expect(
      blocks('<svg viewBox="0 0 10 10"><title>Flow</title><path d="M0 0L9 9"/><use xlink:href="#a"/></svg>', {
        pictures,
      }),
    ).toEqual([{ type: 'image', image: 1, alt: 'Flow' }])
    expect(svgs[0]).toBe(
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
        '<title>Flow</title><path d="M0 0L9 9"></path><use xlink:href="#a"></use></svg>',
    )
    lookup().pictures.svg('x')
    const own = lookup()
    blocks('<svg xmlns="http://www.w3.org/2000/svg"><text>a&nbsp;b</text></svg>', { pictures: own.pictures })
    expect(own.svgs[0]).toBe('<svg xmlns="http://www.w3.org/2000/svg"><text>a&#160;b</text></svg>')
  })

  it('lifts a wide picture out of its paragraph, keeps a small one as its alt text, and drops a spacer', () => {
    const { pictures } = lookup({
      'icon.png': { width: 24, height: 24 },
      'spacer.gif': { width: 12, height: 1 },
      'remote.png': null,
    })
    expect(
      blocks(
        '<p>Press <img src="icon.png" alt="the gear"/> then<img src="spacer.gif" alt="."/> look: ' +
          '<img src="wide.png" alt="Wide"/><img src="remote.png"/></p><p>Next.</p>',
        { pictures },
      ),
    ).toEqual([
      { type: 'paragraph', runs: [{ text: 'Press the gear then look:' }] },
      { type: 'image', image: 3, alt: 'Wide' },
      { type: 'image', image: 4, alt: '' },
      { type: 'paragraph', runs: [{ text: 'Next.' }] },
    ])
  })

  it('lifts pictures out of headings, lists and tables after their block', () => {
    const { pictures } = lookup()
    expect(blocks('<h2>Plates<img src="a.png"/></h2><ul><li>one <img src="b.png"/></li></ul>', { pictures })).toEqual([
      { heading: 'Plates' },
      { type: 'image', image: 1, alt: '' },
      expect.objectContaining({ type: 'list' }),
      {
        type: 'image',
        image: 2,
        alt: '',
      },
    ])
    const table = blocks('<table><tr><td><img src="c.png"/></td></tr><tr><td>v</td></tr></table>', { pictures })
    expect(table.at(-1)).toEqual({ type: 'image', image: 3, alt: '' })
  })

  it('lifts a figure written inside a paragraph, with its caption', () => {
    const { pictures } = lookup()
    expect(
      blocks('<p>Text <figure><img src="a.png" alt="A"/><figcaption>Cap</figcaption></figure> more</p>', { pictures }),
    ).toEqual([
      { type: 'paragraph', runs: [{ text: 'Text  more' }] },
      { type: 'image', image: 1, alt: 'A', caption: [{ text: 'Cap' }] },
    ])
  })

  it('keeps a picture in a caption as its alt text', () => {
    const { pictures } = lookup()
    expect(
      blocks(
        '<figure><p><img src="a.png"/></p><figcaption>See <img src="key.png" alt="the key"/></figcaption></figure>',
        {
          pictures,
        },
      ),
    ).toEqual([{ type: 'image', image: 1, alt: '', caption: [{ text: 'See the key' }] }])
  })

  it('marks a listing its source names as one of Run code’s languages, and only those', () => {
    const items = (html: string) => blocks(html, {})
    expect(items('<pre><code class="language-js">let a = 1</code></pre>')).toEqual([
      { type: 'code', text: 'let a = 1', lang: 'javascript' },
    ])
    expect(items('<pre class="sourceCode python"><code>print(1)</code></pre>')).toEqual([
      { type: 'code', text: 'print(1)', lang: 'python' },
    ])
    expect(items('<pre data-code-language="sql">select 1</pre>')).toEqual([
      { type: 'code', text: 'select 1', lang: 'sql' },
    ])
    expect(items('<pre><code class="language-bash">ls</code></pre>')).toEqual([{ type: 'code', text: 'ls' }])
    expect(items('<pre>let a = 1</pre>')).toEqual([{ type: 'code', text: 'let a = 1' }])
    expect(items('<pre><code class="language-js">a</code><code class="language-js">b</code></pre>')).toEqual([
      { type: 'code', text: 'ab' },
    ])
    expect(sanitise('<pre><code class="language-ts">let a: number = 1</code></pre>')).toBe(
      '<pre data-lang="typescript">let a: number = 1</pre>',
    )
  })

  it('walks a figure without a picture as blocks, its caption a figure of its own', () => {
    const { pictures } = lookup()
    expect(blocks('<figure><pre>let a = 1</pre><figcaption>Listing 1</figcaption></figure>', { pictures })).toEqual([
      { type: 'code', text: 'let a = 1' },
      { type: 'image', image: 0, alt: '', caption: [{ text: 'Listing 1' }] },
    ])
    expect(blocks('<figure><figcaption> </figcaption></figure>', { pictures })).toEqual([])
  })

  it('makes a Markdown title the caption, when asked', () => {
    const { pictures } = lookup()
    const html = '<p><img src="flow.png" alt="Diagram" title="The flow"></p>'
    expect(blocks(html, { pictures, titleAsCaption: true })).toEqual([
      { type: 'image', image: 1, alt: 'Diagram', caption: [{ text: 'The flow' }] },
    ])
    expect(blocks(html, { pictures })).toEqual([{ type: 'image', image: 1, alt: 'Diagram' }])
  })

  it('still drops math, and an img without a src', () => {
    const { pictures, keys } = lookup()
    expect(blocks('<math><mi>x</mi></math><p>a<img alt="no src"/></p>', { pictures })).toEqual([
      { type: 'paragraph', runs: [{ text: 'a' }] },
    ])
    expect(keys).toEqual([])
  })

  it('reads a document without pictures exactly as it did without a lookup', () => {
    const html = '<h2>T</h2><p>a <em>b</em></p><ul><li>c</li></ul><table><tr><td>d</td></tr></table><pre>e</pre>'
    expect(blocks(html, { pictures: lookup().pictures })).toEqual(blocks(html, {}))
  })
})
