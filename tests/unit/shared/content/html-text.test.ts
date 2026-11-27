import { describe, expect, it } from 'vitest'
import { decodeEntities, htmlParagraphs, htmlTextBlocks } from '~/shared/content/html-text'

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities and leaves unknown ones', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#8217; &#x2192; &bogus;')).toBe('a & b <c> ’ → &bogus;')
  })

  it('leaves an entity named like an Object.prototype property as written', () => {
    expect(decodeEntities('a &constructor; b')).toBe('a &constructor; b')
  })
})

describe('htmlParagraphs', () => {
  it('gives one string per paragraph-like element', () => {
    expect(htmlParagraphs('<h3>Title</h3><p>One <em>two</em></p><ul><li>a</li><li>b</li></ul>')).toEqual([
      'Title',
      'One two',
      'a',
      'b',
    ])
  })
})

describe('htmlTextBlocks', () => {
  it('keeps code exactly as written, line breaks and indentation included', () => {
    const html = '<p>An example:</p><pre>function f(x) {\n  return x &lt; 1\n}\n\n</pre>'
    expect(htmlTextBlocks(html)).toEqual(['An example:', '```\nfunction f(x) {\n  return x < 1\n}\n```'])
  })

  it('marks inline code and keeps <br> as a line break', () => {
    expect(htmlTextBlocks('<p>Use <code>let</code> here.<br>Next line</p>')).toEqual(['Use `let` here.\nNext line'])
  })

  it('joins a heading to the block after it, and keeps a heading at the end of the page', () => {
    expect(htmlTextBlocks('<h3>Bindings</h3><h4>Names</h4><p>Text.</p><h3>Next</h3>')).toEqual([
      'Bindings\nNames\n\nText.',
      'Next',
    ])
  })

  it('writes lists as marked lines, nested lists indented', () => {
    const html = '<ul><li>One<ul><li>Inner</li></ul></li><li>Two</li></ul><ol><li>First</li><li>Second</li></ol>'
    expect(htmlTextBlocks(html)).toEqual(['- One\n  - Inner\n- Two', '1. First\n2. Second'])
  })

  it('writes tables as tab-separated rows', () => {
    const html =
      '<table><thead><tr><th>Type</th><th>Example</th></tr></thead><tbody><tr><td>number</td><td><code>1</code></td></tr></tbody></table>'
    expect(htmlTextBlocks(html)).toEqual(['Type\tExample\nnumber\t`1`'])
  })

  it('quotes blockquotes, paragraph by paragraph', () => {
    expect(htmlTextBlocks('<blockquote><p>One.</p><p>Two.</p></blockquote>')).toEqual(['> One.\n>\n> Two.'])
    expect(htmlTextBlocks('<blockquote>Bare.</blockquote>')).toEqual(['> Bare.'])
  })

  it('drops empty elements and whitespace between blocks', () => {
    expect(htmlTextBlocks('<p> </p>\n<p>Kept</p>\n')).toEqual(['Kept'])
  })
})
