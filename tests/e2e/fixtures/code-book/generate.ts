import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { importCollection } from '../../../../scripts/ingest/files/run.ts'
import { makeEpub } from '../../../fixtures/zip.ts'

const DIR = import.meta.dirname
const FILE = 'fixture-code-book.epub'
const FIGURE_FILE = 'fixture-figure-book.epub'

const SENTENCES = [
  'A program is a list of small steps that a computer follows one after another.',
  'Each step reads a value, changes it a little, and hands it on to the next one.',
  'Good names make those steps easy to follow when you come back to them later.',
  'When something goes wrong, reading the code aloud often shows where the mistake is.',
  'Short functions are easier to test, because each one does a single job.',
  'The examples here are small on purpose, so that every line can be read and understood.',
  'Try changing a number in an example and see what the program prints instead.',
  'Comments explain why the code is written the way it is, not what it does.',
  'A value that never changes can be given a name and reused wherever it is needed.',
  'Most bugs hide in the places where two pieces of code meet and disagree.',
  'Writing the test first makes you decide what the code should do before you write it.',
]

function prose(count: number, seed: number): string[] {
  const paragraphs: string[] = []
  let words = 0
  let i = seed
  while (words < count) {
    const paragraph = Array.from({ length: 4 }, (_, k) => SENTENCES[(i + k) % SENTENCES.length] as string)
    i += 4
    words += paragraph.join(' ').split(' ').length
    paragraphs.push(`<p>${paragraph.join(' ')}</p>`)
  }
  return paragraphs
}

const chapters = [
  {
    title: 'Values and Names',
    body: [
      '<p>Start with a single value: the number <code>10</code>, written as it is, with nothing around it.</p>',
      ...prose(560, 0),
      '<pre><code class="language-javascript">let ten = 10;\nconsole.log(ten * ten);\n// → 100</code></pre>',
      '<ul><li>a <code>let</code> binding can change later</li><li>a <code>const</code> binding cannot</li></ul>',
      ...prose(410, 3),
    ],
  },
  {
    title: 'Lists and Tables',
    body: [
      '<p>Some facts are easier to compare side by side, in a table of names and types.</p>',
      '<table><thead><tr><th>Name</th><th>Type</th><th>Example</th></tr></thead><tbody>' +
        '<tr><td>count</td><td>number</td><td><code>42</code></td></tr>' +
        '<tr><td>title</td><td>string</td><td><code>"Folio"</code></td></tr>' +
        '<tr><td>done</td><td>boolean</td><td><code>false</code></td></tr>' +
        '</tbody></table>',
      ...prose(200, 5),
      '<ol><li>Read the error message.</li><li>Find the line it names.</li><li>Change one thing at a time.</li></ol>',
      '<pre><code class="language-typescript">const settings = { theme: "dark", fontSize: 19, leading: 1.85, measure: 660, sidebarHidden: false } satisfies ReaderSettings\nconsole.log(settings.theme)</code></pre>',
      ...prose(200, 7),
    ],
  },
  {
    title: 'Writing About Markup',
    body: [
      '<p>A web page is written in HTML, and a book about HTML has to show its tags as text.</p>',
      '<p>A plain opening angle bracket is written as <code>&amp;lt;</code> (“less than”), and an ampersand as <code>&amp;amp;</code>.</p>',
      '<pre><code>&lt;!doctype html&gt;\n&lt;p&gt;Fish &amp;amp; chips&lt;/p&gt;</code></pre>',
      ...prose(420, 2),
    ],
  },
  {
    title: 'Other languages',
    body: [
      '<p>The same small steps can be written in Python, and a database can be asked questions in SQL.</p>',
      '<pre><code class="language-python">print(sum(range(5)))</code></pre>',
      ...prose(120, 6),
      '<pre><code class="language-sql">create table books (title text, pages integer);\n' +
        "insert into books values ('Emma', 474), ('Persuasion', 249), ('Sanditon', 120);\n" +
        'select title, pages from books order by pages;</code></pre>',
      ...prose(120, 9),
    ],
  },
]

writeFileSync(
  join(DIR, FILE),
  makeEpub({
    title: 'A Small Book of Code',
    author: 'Ada Tester',
    language: 'en',
    cover: {
      name: 'images/cover.jpg',
      data: new Uint8Array(readFileSync(resolve(DIR, '../../../fixtures/images/cover.jpg'))),
    },
    files: [
      { name: 'title.xhtml', body: '<h1>A Small Book of Code</h1><p>A title page, left out of the chapters.</p>' },
      ...chapters.map((c, i) => ({ name: `chapter-${i + 1}.xhtml`, body: `<h2>${c.title}</h2>${c.body.join('')}` })),
    ],
  }),
)

writeFileSync(
  join(DIR, FIGURE_FILE),
  makeEpub({
    title: 'A Small Book of Figures',
    author: 'Ada Tester',
    language: 'en',
    files: ['Drawing the Flow', 'Reading a Chart', 'Keeping It Simple'].map((title, i) => ({
      name: `text/chapter-${i + 1}.xhtml`,
      body: [
        `<h2>${title}</h2>`,
        ...prose(150, i),
        i === 0
          ? '<figure><img src="../images/flow.png" alt="Boxes joined by arrows, left to right"/>' +
            '<figcaption>The flow of a small program</figcaption></figure>'
          : '',
        ...prose(150, i + 4),
      ].join(''),
    })),
    assets: [
      {
        name: 'images/flow.png',
        data: new Uint8Array(readFileSync(resolve(DIR, '../../../fixtures/images/wide.png'))),
      },
    ],
  }),
)

await importCollection({
  collection: { slug: 'code-samples', title: 'Code Samples', kind: 'chapter', tone: 'default', order: 3 },
  series: [
    {
      slug: 'code-fixtures',
      title: 'Code Fixtures',
      description:
        'Small test books of code blocks, lists, tables and a figure, served only by the end-to-end test server.',
      cover: { background: ['#14213d', '#3a5a99'], ink: '#e8eefc', motif: 'grid' },
    },
  ],
  books: [
    {
      slug: 'fixture-code-book',
      title: 'A Small Book of Code',
      author: 'Ada Tester',
      seriesSlug: 'code-fixtures',
      order: 1,
      shortDescription: 'Four short chapters of prose, code, lists and a table, for the tests.',
      tagline: 'Code, lists and tables',
      language: 'en',
      file: FILE,
      source: { name: 'The Folio tests', url: 'https://example.com/fixture-code-book', license: 'CC0' },
      reader: { format: 'epub', options: {} },
    },
    {
      slug: 'fixture-figure-book',
      title: 'A Small Book of Figures',
      author: 'Ada Tester',
      seriesSlug: 'code-fixtures',
      order: 2,
      shortDescription: 'Three short chapters of prose and a figure, for the tests.',
      tagline: 'A figure and its caption',
      language: 'en',
      file: FIGURE_FILE,
      source: { name: 'The Folio tests', url: 'https://example.com/fixture-figure-book', license: 'CC0' },
      reader: { format: 'epub', options: {} },
    },
  ],
  sourceDir: DIR,
  contentDir: resolve(DIR, '../../content'),
})
