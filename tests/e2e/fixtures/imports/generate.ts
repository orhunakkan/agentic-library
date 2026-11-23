import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { chromium } from '@playwright/test'
import { makeEpub, makeZip } from '../../../fixtures/zip.ts'

const DIR = import.meta.dirname
const VOCABULARY =
  'river stone lantern harbour meadow orchard compass journey quiet morning letter garden window bridge winter summer story'.split(
    ' ',
  )

function prose(count: number, seed: number): string {
  const words = Array.from({ length: count }, (_, i) => VOCABULARY[(i * 7 + seed * 3) % VOCABULARY.length] as string)
  return words.map((w, i) => (i % 12 === 11 ? `${w}.` : w)).join(' ')
}

const paragraphs = (seed: number, n = 4) => Array.from({ length: n }, (_, i) => prose(90, seed + i))

const epubChapters = [
  { title: 'Getting Started', marker: 'Lighthouse keepers begin here' },
  { title: 'Second Thoughts', marker: 'Second thoughts arrive' },
  { title: 'A Short Interlude', marker: 'An interlude of rain' },
  { title: 'Final Words', marker: 'The final words' },
]
writeFileSync(
  join(DIR, 'field-notes.epub'),
  makeEpub({
    title: 'Field Notes',
    author: 'Ada Tester',
    language: 'en',
    cover: {
      name: 'images/cover.jpg',
      data: new Uint8Array(readFileSync(join(DIR, '../../../fixtures/images/cover.jpg'))),
    },
    description: '<p>Notes kept by a <i>lighthouse</i> keeper.</p><p>Four short chapters.</p>',
    isbn: '978-0-14-143951-8',
    publisher: 'Tester Press',
    date: '2019-06-01',
    files: [
      { name: 'title.xhtml', body: '<h1>Field Notes</h1><p>A title page, left out of the chapters.</p>' },
      ...epubChapters.map((c, i) => ({
        name: `chapter-${i + 1}.xhtml`,
        body: [
          `<h2>${c.title}</h2>`,
          `<p>${c.marker}. ${paragraphs(i)[0]}</p>`,
          i === 1
            ? '<script>window.__pwned = true</script><p><img src="x" onerror="window.__pwned = true"/>Safe <a href="javascript:window.__pwned=true">link text</a> &lt;b&gt;not bold&lt;/b&gt;.</p>'
            : '',
          `<h3>Notes on ${c.title.toLowerCase()}</h3>`,
          ...paragraphs(i)
            .slice(1)
            .map((p) => `<p>${p}</p>`),
          '<pre><code>const answer = 42\nconsole.log(answer &lt; 100)</code></pre>',
        ].join(''),
      })),
    ],
  }),
)

writeFileSync(
  join(DIR, 'garden-diary.md'),
  [
    '---',
    'title: Garden Diary',
    'author: Grace Tester',
    'language: en',
    '---',
    '',
    '# Garden Diary',
    '',
    'An introduction, left out of the chapters.',
    '',
    ...['Spring Planting', 'Summer Harvest', 'Autumn Leaves'].flatMap((title, i) => [
      `## ${title}`,
      '',
      ...paragraphs(10 + i).flatMap((p) => [p, '']),
      '- a *first* item',
      '- a **second** item',
      '',
    ]),
  ].join('\n'),
)

const handbook = (title: string, seed: number) =>
  [`# ${title}`, '', ...paragraphs(seed).flatMap((p) => [p, ''])].join('\n')
writeFileSync(
  join(DIR, 'team-handbook.zip'),
  makeZip([
    {
      name: 'handbook/book.toml',
      data: '[book]\ntitle = "Team Handbook"\nauthors = ["Lin Tester"]\nlanguage = "en"\n',
    },
    {
      name: 'handbook/src/SUMMARY.md',
      data: '# Summary\n\n- [Welcome](./welcome.md)\n- [How We Work](process/how-we-work.md)\n- [Appendix](appendix.md)\n',
    },
    { name: 'handbook/src/appendix.md', data: handbook('Appendix', 20) },
    { name: 'handbook/src/process/how-we-work.md', data: handbook('How We Work', 21) },
    { name: 'handbook/src/welcome.md', data: handbook('Welcome', 22) },
  ]),
)

const fixtureImage = (name: string) => new Uint8Array(readFileSync(join(DIR, '../../../fixtures/images', name)))

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function png(width: number, height: number, { corrupt = false } = {}): Uint8Array {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set(corrupt ? [3, 9, 0, 0, 0] : [8, 6, 0, 0, 0], 8)
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rows.set([40, 90, 160, 255], y * (width * 4 + 1) + 1 + x * 4)
  const pixels = corrupt ? Buffer.from('these bytes are not a zlib stream of pixels') : deflateSync(rows)
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', pixels),
      pngChunk('IEND', new Uint8Array()),
    ]),
  )
}

const FLOW_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120" width="320" height="120"><title>Three steps</title>' +
  '<rect x="10" y="30" width="80" height="60" fill="#2563eb"/><rect x="120" y="30" width="80" height="60" fill="#16a34a"/>' +
  '<rect x="230" y="30" width="80" height="60" fill="#dc2626"/></svg>'
const figureChapters = [
  {
    title: 'Charts and Maps',
    pictures:
      '<figure><img src="../images/harbour.png" alt="A chart of the harbour"/>' +
      '<figcaption>The harbour at low tide</figcaption></figure>',
  },
  { title: 'Steps in Order', pictures: FLOW_SVG },
  {
    title: 'Letters Home',
    pictures:
      '<p>A photograph came with the letter. <img src="../images/letter.jpg" alt="The letter"/>' +
      '<img src="../images/spacer.png" alt=""/> It was kept.</p>',
  },
  {
    title: 'Lost Pictures',
    pictures: '<p><img src="https://example.com/remote.png" alt="From the web"/></p><img src="../images/broken.png"/>',
  },
]
writeFileSync(
  join(DIR, 'figures.epub'),
  makeEpub({
    title: 'Harbour Pictures',
    author: 'Ada Tester',
    language: 'en',
    files: figureChapters.map((c, i) => ({
      name: `text/chapter-${i + 1}.xhtml`,
      body: [
        `<h2>${c.title}</h2>`,
        `<p>${paragraphs(30 + i)[0]}</p>`,
        c.pictures,
        `<p>${paragraphs(40 + i)[1]}</p>`,
      ].join(''),
    })),
    assets: [
      { name: 'images/harbour.png', data: fixtureImage('wide.png') },
      { name: 'images/letter.jpg', data: fixtureImage('cover.jpg') },
      { name: 'images/spacer.png', data: png(12, 12) },
      { name: 'images/broken.png', data: png(200, 100, { corrupt: true }) },
    ],
  }),
)

writeFileSync(
  join(DIR, 'figures-handbook.zip'),
  makeZip([
    { name: 'guide/book.toml', data: '[book]\ntitle = "Flow Guide"\nauthors = ["Lin Tester"]\nlanguage = "en"\n' },
    {
      name: 'guide/one.md',
      data: [handbook('The Flow', 50), '![Diagram](images/flow.png "The flow")', ''].join('\n'),
    },
    { name: 'guide/two.md', data: handbook('Second Steps', 51) },
    { name: 'guide/three.md', data: handbook('Third Steps', 52) },
    { name: 'guide/images/flow.png', data: fixtureImage('wide.png') },
  ]),
)

const FONTS = join(DIR, '../../../../node_modules')
const fontFace = (family: string, file: string, descriptors = '') =>
  `@font-face { font-family: ${family}; src: url(data:font/woff2;base64,${readFileSync(join(FONTS, file)).toString('base64')}); ${descriptors} }`
const FONT_FACES = [
  fontFace(
    'Body',
    '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2',
    'font-weight: 200 900;',
  ),
  fontFace(
    'Body',
    '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-italic.woff2',
    'font-weight: 200 900; font-style: italic;',
  ),
  fontFace('Head', '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2', 'font-weight: 100 900;'),
  fontFace('Mono', '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2'),
  fontFace('Maths', '@fontsource/noto-sans-math/files/noto-sans-math-latin-400-normal.woff2'),
].join('\n')

const imageUrl = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`

const steadyDates = (pdf: Buffer) =>
  Buffer.from(pdf.toString('latin1').replace(/D:\d{14}[+-]\d\d'\d\d'/g, "D:20260101000000+00'00'"), 'latin1')

const browser = await chromium.launch()
const page = await browser.newPage()

async function printPdf(name: string, html: string, options: { outline?: boolean } = {}): Promise<void> {
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  const outline = options.outline ?? false
  const pdf = await page.pdf({ preferCSSPageSize: true, outline, tagged: outline, printBackground: true })
  writeFileSync(join(DIR, name), steadyDates(pdf))
}

const LISTING = [
  'function trim(wick) {',
  '  if (wick.length > 4) {',
  '    return wick.slice(0, 4)',
  '  }',
  '  return wick',
  '}',
].join('\n')
const DIAGRAM =
  '<svg width="240" height="110" viewBox="0 0 240 110" xmlns="http://www.w3.org/2000/svg">' +
  '<rect x="4" y="10" width="60" height="80" fill="#dbeafe" stroke="#1e3a8a"/>' +
  '<rect x="90" y="10" width="60" height="80" fill="#dcfce7" stroke="#14532d"/>' +
  '<rect x="176" y="10" width="60" height="80" fill="#fee2e2" stroke="#7f1d1d"/>' +
  '<path d="M64 50 L90 50 M150 50 L176 50" stroke="#111" stroke-width="2"/>' +
  '<text x="34" y="54" font-family="Head" font-weight="700" font-size="10" text-anchor="middle">Lamp</text>' +
  '<text x="120" y="54" font-family="Head" font-weight="700" font-size="10" text-anchor="middle">Lens</text>' +
  '<text x="206" y="54" font-family="Head" font-weight="700" font-size="10" text-anchor="middle">Ship</text></svg>'
const TABLE =
  '<table><tr><th>Date</th><th>Weather</th><th>Hours lit</th></tr>' +
  '<tr><td>3 May</td><td>Fog</td><td>11</td></tr><tr><td>4 May</td><td>Rain</td><td>9</td></tr>' +
  '<tr><td>5 May</td><td>Clear</td><td>8</td></tr></table>'
const handbookChapters = [
  {
    title: 'Keeping the Light',
    sections: ['Trimming the Wick', 'Daily Rounds'],
    picture: `<figure><img src="${imageUrl(png(360, 240))}" alt=""><figcaption>Figure 1.1 The lamp room at dusk.</figcaption></figure>`,
    footnote: true,
  },
  {
    title: 'Signals and Codes',
    sections: ['Reading the Flags', 'Sending at Night'],
    picture: `<figure>${DIAGRAM}<figcaption>Figure 2.1 How a signal travels.</figcaption></figure>`,
    footnote: false,
  },
  {
    title: 'Keeping Records',
    sections: ['The Logbook', 'Weather Notes'],
    picture: `<figure>${TABLE}<figcaption>Table 3.1 Three days of the keeper’s log.</figcaption></figure>`,
    footnote: false,
  },
]
const handbookPage = (title: string, i: number) => `
  @page ch${i} {
    @top-center { content: "${title}"; font-family: Body; font-style: italic; font-size: 8pt }
    @bottom-center { content: counter(page); font-family: Body; font-size: 8pt }
  }
  .ch${i} { page: ch${i} }`
const handbookChapter = (c: (typeof handbookChapters)[number], i: number) =>
  [
    `<section class="ch${i}">`,
    `<h1>${c.title}</h1>`,
    `<p>${prose(80, 60 + i)}</p>`,
    '<p>A keeper learns <em>patience</em> before anything, and <strong>care</strong> soon after; the lamp is lit by ' +
      'calling <code>light()</code> once at dusk. The work of trans-<br>formation is slow.</p>',
    `<h2>${c.sections[0]}</h2>`,
    `<p>${prose(90, 62 + i)}</p>`,
    '<ul><li>a clean glass, polished every morning before the sun is high over the water and the harbour</li>' +
      '<li>a trimmed wick</li><li>a full reservoir</li></ul>',
    `<p>${prose(70, 64 + i)}</p>`,
    `<pre>${LISTING}</pre>`,
    c.picture,
    `<h2>${c.sections[1]}</h2>`,
    `<p>${prose(80, 66 + i)}</p>`,
    '<ol><li>climb the stair</li><li>wind the clock</li><li>light the lamp</li></ol>',
    `<p>${prose(60, 68 + i)}</p>`,
    c.footnote
      ? `<p>The first keeper kept a diary of every night.<sup>1</sup> ${prose(30, 70)}</p>` +
        '<div class="rule"></div><p class="note">1 The diary is kept in the harbour office.</p>'
      : `<p>${prose(60, 70 + i)}</p>`,
    '</section>',
  ].join('')
await printPdf(
  'pdf-handbook.pdf',
  `<!doctype html><html lang="en"><head><title>The Lantern Handbook</title><style>
  ${FONT_FACES}
  @page { size: A5; margin: 18mm 16mm }
  ${handbookChapters.map((c, i) => handbookPage(c.title, i)).join('\n')}
  body { margin: 0; font: 10pt/14pt Body; text-align: left }
  section + section { break-before: page }
  h1 { font: 700 20pt/24pt Head; margin: 0 0 14pt }
  h2 { font: 700 13pt/16pt Head; margin: 14pt 0 6pt }
  p { margin: 0 0 7pt }
  code, pre { font-family: Mono; font-size: 8.5pt }
  pre { background: #e8edf3; padding: 8pt 10pt; margin: 0 0 9pt; line-height: 11pt }
  ul { list-style-type: '•  '; padding-left: 16pt; margin: 0 0 7pt }
  ol { padding-left: 16pt; margin: 0 0 7pt }
  figure { margin: 10pt 0; text-align: center; break-inside: avoid }
  figure img { width: 180pt }
  figcaption { font: italic 9pt/12pt Body; margin-top: 6pt }
  table { border-collapse: collapse; margin: 0 auto; font-size: 9pt }
  th, td { border: 0.75pt solid #333; padding: 3pt 12pt }
  th { font-weight: 700 }
  .rule { width: 30%; border-top: 0.5pt solid #333; margin: 18pt 0 4pt }
  .note { font-size: 8pt; line-height: 10pt; margin: 0 }
  </style></head><body>${handbookChapters.map(handbookChapter).join('')}</body></html>`,
  { outline: true },
)

const para = (seed: number, words = 70) => `<p>${prose(words, seed)}</p>`
const BARS =
  '<svg width="420" height="110" viewBox="0 0 420 110" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M20 100 L400 100 M20 100 L20 10" stroke="#111" stroke-width="1"/>' +
  [60, 150, 240, 330]
    .map((x, i) => `<rect x="${x}" y="${100 - (i + 2) * 18}" width="40" height="${(i + 2) * 18}" fill="#93c5fd"/>`)
    .join('') +
  '<text x="210" y="8" font-family="Head" font-size="9" text-anchor="middle">Nights lit per harbour</text></svg>'
interface PaperPage {
  top?: string
  figure?: string
  left: string
  right: string
  notes?: string
}
const paperPages: PaperPage[] = [
  {
    top:
      '<h1>Lanterns at Sea: A Short Study</h1><p class="authors">Ada Tester and Lin Tester</p>' +
      `<div class="abstract"><p><b>Abstract.</b> ${prose(60, 80)}</p></div>`,
    left: `<h2>1 Introduction</h2>${para(81)}${para(82)}${para(83, 50)}`,
    right: `${para(84)}${para(85)}`,
  },
  {
    left:
      `<h2>2 Method</h2>${para(86)}<p class="first">${prose(30, 87)} as follows:</p>` +
      `<div class="equation">f(x) = a·x + b·y − c</div><p class="first">${prose(40, 88)}</p>`,
    right: `<p>The harbours were chosen by hand.<sup>1</sup> ${prose(60, 89)}</p>${para(90)}`,
    notes: '<p>1 Four harbours on the north coast.</p>',
  },
  {
    figure: `<figure>${BARS}<figcaption>Figure 1. Nights lit at each of the four harbours.</figcaption></figure>`,
    left: `<h2>3 Results</h2>${para(91)}${para(92)}`,
    right: `${para(93)}${para(94, 50)}`,
  },
  {
    left: `<h2>4 Discussion</h2>${para(95)}${para(96)}`,
    right: `<p>Later work may repeat the count.<sup>2</sup> ${prose(60, 97)}</p>${para(98, 40)}`,
    notes: '<p>2 With the winter months included.</p>',
  },
]
const paperPage = (p: PaperPage, i: number) =>
  `<div class="page">${p.top ?? ''}${p.figure ?? ''}<div class="cols"><div class="col">${p.left}</div>` +
  `<div class="col">${p.right}</div></div>${p.notes ? `<div class="notes">${p.notes}</div>` : ''}` +
  `<div class="folio">${i + 1}</div></div>`
await printPdf(
  'pdf-paper.pdf',
  `<!doctype html><html lang="en"><head><style>
  ${FONT_FACES}
  @page { size: A4; margin: 0 }
  body { margin: 0; font: 9.5pt/12pt Body; text-align: justify }
  .page { position: relative; box-sizing: border-box; width: 210mm; height: 297mm; padding: 22mm 19mm; break-after: page; overflow: hidden }
  h1 { font: 700 18pt/22pt Head; text-align: center; margin: 0 0 8pt }
  .authors { text-align: center; text-indent: 0; margin-bottom: 12pt }
  .abstract { margin: 0 14mm 16pt; font-size: 9pt }
  .abstract p { text-indent: 0 }
  .cols { display: flex; gap: 9mm }
  .col { flex: 1 }
  h2 { font: 700 11pt/14pt Head; margin: 4pt 0 6pt }
  p { margin: 0; text-indent: 12pt }
  h2 + p, p.first { text-indent: 0 }
  .equation { font: 10pt/12pt Maths; text-align: center; margin: 10pt 0 }
  figure { margin: 0 0 16pt; text-align: center }
  figcaption { font: italic 9pt/12pt Body; margin-top: 4pt }
  .notes { position: absolute; left: 19mm; right: 19mm; bottom: 24mm; font-size: 7.5pt; line-height: 9pt }
  .notes p { text-indent: 0 }
  .folio { position: absolute; left: 0; right: 0; bottom: 12mm; text-align: center; font-size: 8pt }
  </style></head><body>${paperPages.map(paperPage).join('')}</body></html>`,
)

const scan = await page.evaluate(() => {
  const canvas = document.createElement('canvas')
  canvas.width = 620
  canvas.height = 877
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  ctx.fillStyle = '#f7f5ef'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#333'
  for (let line = 0; line < 30; line++) ctx.fillRect(60, 70 + line * 24, 500 - ((line * 37) % 120), 10)
  return canvas.toDataURL('image/png')
})
await printPdf(
  'pdf-scanned.pdf',
  `<!doctype html><html><head><style>@page { size: A4; margin: 0 } body { margin: 0 }
  img { display: block; width: 210mm; height: 297mm; break-after: page }</style></head>
  <body><img src="${scan}" alt=""><img src="${scan}" alt=""></body></html>`,
)
await browser.close()

console.log(`fixtures → ${DIR}`)
