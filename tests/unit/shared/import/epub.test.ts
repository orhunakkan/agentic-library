import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chapterNumber, readEpub } from '~/shared/import/epub'
import { renderBlocks } from '~/shared/import/render'
import { makeEpub, words } from '../../../fixtures/zip'

const body = (title: string, n = 320) => `<h2>${title}</h2><p>${words(n)}</p>`

describe('readEpub', () => {
  it('reads metadata and detects the chapter level across spine files', async () => {
    const epub = makeEpub({
      title: 'Spined',
      author: 'Grace Hopper',
      language: 'en-GB',
      files: [
        { name: 'front.xhtml', body: '<h1>Spined</h1><p>Front matter, dropped.</p>' },
        { name: 'one.xhtml', body: body('One') + body('Two') },
        { name: 'two.xhtml', body: body('Three') },
      ],
    })
    const book = await readEpub(epub)
    expect(book).toMatchObject({ title: 'Spined', author: 'Grace Hopper', language: 'en-GB', chapterLevel: 2 })
    expect(book.chapters.map((c) => c.title)).toEqual(['One', 'Two', 'Three'])
  })

  it('splits at a named heading level and skips chapters by title', async () => {
    const epub = makeEpub({
      files: [{ name: 'all.xhtml', body: `${body('Keep', 5)}${body('Support the Project', 5)}<h3>Sub</h3><p>x</p>` }],
    })
    const book = await readEpub(epub, { chapterHeading: 'h2', skipChapters: ['Support the Project'] })
    expect(book.chapters.map((c) => c.title)).toEqual(['Keep'])
  })

  it('keeps the old whitespace rules for lists, code in lists and empty elements', async () => {
    const epub = makeEpub({
      files: [
        {
          name: 'a.xhtml',
          body: [
            '<h2>Rules</h2>',
            '<ul>\n<li>\n<p>first</p>\n<p>second</p>\n</li><li>run <pre>let  x\n= 1</pre></li><li><strong> </strong>tail<br/></li></ul>',
            '<p>  <a href="#x">linked</a> <span>and</span> <i>slanted</i> <b></b> </p>',
            '<blockquote>bare quote</blockquote>',
            '<table><tbody><tr><td> </td></tr><tr><td>cell <code>c</code></td></tr></tbody></table>',
            '<figure><img src="a.png"/><figcaption>kept caption</figcaption></figure>',
          ].join(''),
        },
      ],
    })
    const [chapter] = (await readEpub(epub, { chapterHeading: 'h2' })).chapters
    expect(renderBlocks(chapter?.blocks ?? []).map((b) => b.html)).toEqual([
      '<ul><li>first  second</li><li>run <br><code>let x = 1</code></li><li>tail</li></ul>',
      '<p>linked and <em>slanted</em></p>',
      '<blockquote><p>bare quote</p></blockquote>',
      '<table><tbody><tr><td>cell <code>c</code></td></tr></tbody></table>',
      '<figure><figcaption>kept caption</figcaption></figure>',
    ])
  })

  it('numbers chapters headed by a bare numeral, Roman or Arabic, and keeps real titles', async () => {
    const epub = makeEpub({
      files: [
        { name: 'a.xhtml', body: body('I') + body('IV.') + body('XLIX') },
        { name: 'b.xhtml', body: body('12') + body('A Real Title') + body('DID') + body('Imprint') },
      ],
    })
    const numbered = await readEpub(epub, { numberedChapters: true, skipChapters: ['Imprint'] })
    expect(numbered.chapters.map((c) => c.title)).toEqual([
      'Chapter 1',
      'Chapter 4',
      'Chapter 49',
      'Chapter 12',
      'A Real Title',
      'DID',
    ])
    expect((await readEpub(epub)).chapters.map((c) => c.title)).toEqual([
      'I',
      'IV.',
      'XLIX',
      '12',
      'A Real Title',
      'DID',
      'Imprint',
    ])
  })

  it('reads a numeral as a number only when it is one', () => {
    expect(chapterNumber('LXI')).toBe(61)
    expect(chapterNumber(' MCMXC ')).toBe(1990)
    expect(chapterNumber('7')).toBe(7)
    for (const title of ['', '0', 'IIII', 'iv', 'VX', 'Mix', 'Chapter 3', '12a'])
      expect(chapterNumber(title)).toBeNull()
  })

  it('names the file when the EPUB has no title, and refuses a broken one', async () => {
    const epub = makeEpub({ title: '', files: [{ name: 'a.xhtml', body: '<p>Only text.</p>' }] })
    const book = await readEpub(epub, { fileName: 'untitled_draft.epub' })
    expect(book.title).toBe('untitled draft')
    expect(book.chapters).toHaveLength(1)
    await expect(readEpub(new Uint8Array(100))).rejects.toThrow(/not a ZIP/)
  })
})

const image = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../fixtures/images/${name}`, import.meta.url)))
const chapters = [{ name: 'a.xhtml', body: body('One') }]

describe('readEpub: the cover', () => {
  it('takes the EPUB 3 cover-image item', async () => {
    const book = await readEpub(
      makeEpub({ files: chapters, cover: { name: 'images/cover.jpg', data: image('cover.jpg') } }),
    )
    expect(book.cover).toMatchObject({ from: 'epub', info: { type: 'image/jpeg', width: 400, height: 600 } })
    expect(book.cover?.bytes).toEqual(image('cover.jpg'))
  })

  it('takes the EPUB 2 meta name="cover" item', async () => {
    const book = await readEpub(
      makeEpub({ files: chapters, legacyCover: { name: 'wide.png', data: image('wide.png'), mediaType: 'image/png' } }),
    )
    expect(book.cover?.info).toEqual({ type: 'image/png', width: 900, height: 600 })
  })

  it('prefers the EPUB 3 item when both are there', async () => {
    const book = await readEpub(
      makeEpub({
        files: chapters,
        cover: { name: 'new.jpg', data: image('cover.jpg') },
        legacyCover: { name: 'old.png', data: image('wide.png'), mediaType: 'image/png' },
      }),
    )
    expect(book.cover?.info.type).toBe('image/jpeg')
  })

  it('gives no cover, without throwing, for none, a missing file or an SVG', async () => {
    expect((await readEpub(makeEpub({ files: chapters }))).cover).toBeNull()
    expect((await readEpub(makeEpub({ files: chapters, coverPath: 'gone.jpg' }))).cover).toBeNull()
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900"/></svg>'
    const book = await readEpub(
      makeEpub({ files: chapters, cover: { name: 'cover.svg', data: svg, mediaType: 'image/svg+xml' } }),
    )
    expect(book.cover).toBeNull()
    expect(book.chapters).toHaveLength(1)
  })
})

describe('readEpub: the details', () => {
  it('reads an HTML description, an ISBN after a URL identifier, the publisher and the year', async () => {
    const book = await readEpub(
      makeEpub({
        files: chapters,
        description: '<p><i>A</i> novel &amp; more.</p><p>Second.</p>',
        identifiers: ['https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice'],
        isbn: '978-0-14-143951-8',
        publisher: 'Penguin Classics',
        date: '2003-04-29',
      }),
    )
    expect(book.details).toEqual({
      description: 'A novel & more.\n\nSecond.',
      isbn: '9780141439518',
      publisher: 'Penguin Classics',
      publishedYear: 2003,
    })
  })

  it('leaves out a URL identifier and gives empty details when the OPF has none', async () => {
    const book = await readEpub(makeEpub({ files: chapters, identifiers: ['urn:uuid:1234', 'https://example.com'] }))
    expect(book.details).toEqual({ description: null, isbn: null, publisher: null, publishedYear: null })
  })
})

describe('readEpub: pictures', () => {
  const png = new Uint8Array(readFileSync(new URL('../../../fixtures/images/wide.png', import.meta.url)))

  it('resolves pictures against the chapter file, and names the ones it can’t read', async () => {
    const epub = makeEpub({
      files: [
        {
          name: 'text/one.xhtml',
          body:
            `<h2>One</h2><p>${words(120)}</p><figure><img src="../images/map.png" alt="Map"/><figcaption>The bay</figcaption></figure>` +
            '<p><img src="../images/a%20b.png"/></p><img src="https://example.com/x.png"/><img src="gone.png"/>',
        },
        { name: 'text/two.xhtml', body: `<h2>Two</h2><p>${words(120)}</p><img src="../images/map.png"/>` },
        { name: 'three.xhtml', body: `<h2>Three</h2><p>${words(120)}</p><img src="./images/map.png"/>` },
      ],
      assets: [
        { name: 'images/map.png', data: png },
        { name: 'images/a b.png', data: png },
      ],
    })
    const book = await readEpub(epub)
    expect(book.chapters.map((c) => c.title)).toEqual(['One', 'Two', 'Three'])
    const images = (i: number) => book.chapters[i]?.blocks.filter((b) => b.type === 'image')
    expect(images(0)).toEqual([
      { type: 'image', image: 1, alt: 'Map', caption: [{ text: 'The bay' }] },
      { type: 'image', image: 2, alt: '' },
      { type: 'image', image: 3, alt: '' },
      { type: 'image', image: 4, alt: '' },
    ])
    expect(images(1)).toEqual([{ type: 'image', image: 1, alt: '' }])
    expect(images(2)).toEqual([{ type: 'image', image: 1, alt: '' }])
    expect(book.pictures.map((p) => [p.key, 'problem' in p ? p.problem : p.type])).toEqual([
      ['OEBPS/images/map.png', 'image/png'],
      ['OEBPS/images/a b.png', 'image/png'],
      ['https://example.com/x.png', 'remote'],
      ['OEBPS/text/gone.png', 'missing'],
    ])
  })

  it('has no pictures, and the same chapters, when the text has none', async () => {
    const book = await readEpub(
      makeEpub({ files: [{ name: 'a.xhtml', body: body('One') + body('Two') + body('Three') }] }),
    )
    expect(book.pictures).toEqual([])
    expect(book.chapters.every((c) => c.blocks.every((b) => b.type === 'paragraph'))).toBe(true)
  })
})
