import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { makeZip, words } from '../../../tests/fixtures/zip'
import type { DraftChapter } from './blocks'
import { readMarkdownFile, readMarkdownZip, summaryOrder } from './markdown'
import { renderBlocks } from './render'

const html = (chapter: DraftChapter | undefined) => renderBlocks(chapter?.blocks ?? []).map((b) => b.html)
const image = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/images/${name}`, import.meta.url)))
const chapter = (title: string, n = 320) => `## ${title}\n\n${words(n)}\n`

describe('a single Markdown file', () => {
  it('takes metadata from front matter and splits chapters at the detected level', () => {
    const book = readMarkdownFile(
      `---\ntitle: Field Notes\nauthor: Ada Tester\nlanguage: de\n---\n# Field Notes\n\nIntro.\n\n${chapter('One')}${chapter('Two')}${chapter('Three')}`,
      'notes.md',
    )
    expect(book).toMatchObject({ title: 'Field Notes', author: 'Ada Tester', language: 'de', chapterLevel: 2 })
    expect(book.chapters.map((c) => c.title)).toEqual(['One', 'Two', 'Three'])
  })

  it('takes the details from front matter, and has no cover', () => {
    const book = readMarkdownFile(
      '---\ntitle: Garden\ndescription: "Notes from a <b>small</b> garden."\nisbn: 978-0-14-143951-8\npublisher: Me\ndate: 2024-05-01\n---\n# Garden\n\nText.',
      'garden.md',
    )
    expect(book.details).toEqual({
      description: 'Notes from a small garden.',
      isbn: '9780141439518',
      publisher: 'Me',
      publishedYear: 2024,
    })
    expect(book.cover).toBeNull()
    expect(readMarkdownFile('---\nisbn: 123\n---\nText.', 'x.md').details.isbn).toBeNull()
  })

  it('falls back to the only h1, then the file name, for the title', () => {
    expect(readMarkdownFile('# The Title\n\nText.', 'x.md').title).toBe('The Title')
    expect(readMarkdownFile('# A\n\n# B\n\nText.', 'two_heads.md').title).toBe('two heads')
  })

  it('keeps the reader subset and sanitises like an EPUB', () => {
    const book = readMarkdownFile(
      [
        'Some *emphasis*, **strong**, `code` and a [link](https://example.com) with ![an image](x.png).',
        '',
        '<script>alert(1)</script>',
        '',
        '<p onclick="steal()">raw <b>html</b> <img src=x onerror=alert(1)></p>',
        '',
        '> quoted',
        '',
        '- one',
        '  - nested',
        '- two',
        '',
        '| a | b |',
        '|---|---|',
        '| 1 | <i>2</i> |',
        '',
        '```js',
        'if (a < b) {',
        '\treturn "<tag>"',
        '}',
        '```',
      ].join('\n'),
      'mixed.md',
    )
    expect(book.chapterLevel).toBeNull()
    expect(html(book.chapters[0])).toEqual([
      '<p>Some <em>emphasis</em>, <strong>strong</strong>, <code>code</code> and a link with .</p>',
      '<p>raw <strong>html</strong></p>',
      '<blockquote><p>quoted</p></blockquote>',
      '<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>',
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><em>2</em></td></tr></tbody></table>',
      '<pre data-lang="javascript">if (a &lt; b) {\n  return "&lt;tag&gt;"\n}</pre>',
    ])
  })
})

describe('a ZIP of Markdown files', () => {
  it('follows SUMMARY.md, resolving links against its folder, and reads book.toml', async () => {
    const zip = makeZip([
      { name: 'book/book.toml', data: '[book]\ntitle = "Zipped"\nauthors = ["Grace"]\nlanguage = "fr"\n' },
      {
        name: 'book/src/SUMMARY.md',
        data: '# Summary\n\n- [Last first](./c.md)\n- [Then A](a.md#top)\n  - [Nested B](sub/b%20file.md "B")\n- [Again](c.md)\n- [Web](https://example.com/x.md)\n- [Missing](gone.md)\n',
      },
      { name: 'book/src/a.md', data: `# A\n\n${words(320)}` },
      { name: 'book/src/sub/b file.md', data: `# B\n\n${words(320)}` },
      { name: 'book/src/c.md', data: `# C\n\n${words(320)}` },
      { name: 'book/src/unlisted.md', data: `# Unlisted\n\n${words(320)}` },
    ])
    const book = await readMarkdownZip(zip, 'zipped.zip')
    expect(book).toMatchObject({ title: 'Zipped', author: 'Grace', language: 'fr', chapterLevel: 1 })
    expect(book.chapters.map((c) => c.title)).toEqual(['C', 'A', 'B'])
  })

  it('goes in natural path order without SUMMARY.md, skipping hidden files', async () => {
    const zip = makeZip([
      { name: '10-deploy.md', data: `# Deploy\n\n${words(320)}` },
      { name: '2-setup.md', data: `---\ntitle: Not this one\n---\n# Setup\n\n${words(320)}` },
      { name: '1-intro.markdown', data: `---\ntitle: Ordered\nauthor: Ada\n---\n# Intro\n\n${words(320)}` },
      { name: '__MACOSX/._1-intro.md', data: 'resource fork' },
      { name: '.hidden.md', data: '# Hidden' },
      { name: 'image.png', data: new Uint8Array([1, 2, 3]) },
    ])
    const book = await readMarkdownZip(zip, 'ordered.zip')
    expect(book.chapters.map((c) => c.title)).toEqual(['Intro', 'Setup', 'Deploy'])
    expect(book).toMatchObject({ title: 'Ordered', author: 'Ada' })
  })

  it('takes book.toml’s details and a cover.png beside SUMMARY.md', async () => {
    const zip = makeZip([
      {
        name: 'book/book.toml',
        data: '[book]\ntitle = "Zipped"\ndescription = "A [handbook](https://x.test) for teams."\nisbn = "0141439513"\npublisher = "Ourselves"\nyear = "2021"\n[output.html]\ndescription = "not this"\n',
      },
      { name: 'book/src/SUMMARY.md', data: '- [A](a.md)\n' },
      { name: 'book/src/a.md', data: `# A\n\n${words(320)}` },
      { name: 'book/src/cover.png', data: image('wide.png') },
      { name: 'book/src/deeper/cover.jpg', data: image('cover.jpg') },
    ])
    const book = await readMarkdownZip(zip, 'zipped.zip')
    expect(book.details).toEqual({
      description: 'A handbook for teams.',
      isbn: '9780141439518',
      publisher: 'Ourselves',
      publishedYear: 2021,
    })
    expect(book.cover).toMatchObject({ from: 'zip', info: { type: 'image/png', width: 900, height: 600 } })
  })

  it('takes a cover at the root, the shallowest first, and skips one that isn’t an image', async () => {
    const zip = makeZip([
      { name: 'a.md', data: `# A\n\n${words(320)}` },
      { name: 'cover.jpg', data: image('cover.jpg') },
      { name: 'notes/cover.png', data: image('wide.png') },
    ])
    expect((await readMarkdownZip(zip, 'a.zip')).cover?.info.type).toBe('image/jpeg')
    const broken = makeZip([
      { name: 'a.md', data: `# A\n\n${words(320)}` },
      { name: 'cover.jpg', data: image('not-an-image.jpg') },
    ])
    const book = await readMarkdownZip(broken, 'a.zip')
    expect(book.cover).toBeNull()
    expect(book.details).toEqual({ description: null, isbn: null, publisher: null, publishedYear: null })
  })

  it('refuses a ZIP with no Markdown in it', async () => {
    await expect(readMarkdownZip(makeZip([{ name: 'a.txt', data: 'x' }]), 'a.zip')).rejects.toThrow(/no Markdown/)
  })

  it('summaryOrder lists each linked file once', () => {
    const files = new Set(['a.md', 'b.md'])
    expect(summaryOrder('[x](b.md) [y](a.md) [z](b.md)', 'SUMMARY.md', files)).toEqual(['b.md', 'a.md'])
  })
})

describe('pictures in Markdown', () => {
  it('reads a ZIP’s pictures beside the chapter, with the title as the caption', async () => {
    const zip = makeZip([
      { name: 'book/one.md', data: `# One\n\n${words(150)}\n\n![Diagram](images/flow.png "The flow")\n` },
      { name: 'book/two.md', data: `# Two\n\n${words(150)}\n\n![](../book/images/flow.png)\n\n![x](nope.png)\n` },
      { name: 'book/three.md', data: `# Three\n\n${words(150)}\n` },
      { name: 'book/images/flow.png', data: image('wide.png') },
    ])
    const book = await readMarkdownZip(zip, 'book.zip')
    expect(book.chapters[0]?.blocks.at(-1)).toEqual({
      type: 'image',
      image: 1,
      alt: 'Diagram',
      caption: [{ text: 'The flow' }],
    })
    expect(book.chapters[2]?.blocks.filter((b) => b.type === 'image')).toEqual([
      { type: 'image', image: 1, alt: '' },
      { type: 'image', image: 2, alt: 'x' },
    ])
    expect(book.pictures.map((p) => [p.key, 'problem' in p ? p.problem : p.type])).toEqual([
      ['book/images/flow.png', 'image/png'],
      ['book/nope.png', 'missing'],
    ])
  })

  it('finds a single file’s relative pictures missing, and its remote ones remote', () => {
    const book = readMarkdownFile(
      `# T\n\n${words(20)}\n\n![Local](a.png)\n\n![Web](https://example.com/b.png)\n`,
      'notes.md',
    )
    expect(book.chapters[0]?.blocks.filter((b) => b.type === 'image')).toEqual([
      { type: 'image', image: 1, alt: 'Local' },
      { type: 'image', image: 2, alt: 'Web' },
    ])
    expect(book.pictures).toEqual([
      { key: 'a.png', problem: 'missing' },
      { key: 'https://example.com/b.png', problem: 'remote' },
    ])
  })
})
