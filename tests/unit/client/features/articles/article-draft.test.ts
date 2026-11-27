import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { type ArticleDraft, draftArticle, type ReadabilityResult } from '~/client/features/articles/article-draft'
import type { BookBlock } from '~/shared/import/blocks'
import { renderBlocks } from '~/shared/import/render'
import { XSS_CORPUS } from '../../../../fixtures/xss-corpus'

const saved = (name: string) =>
  JSON.parse(readFileSync(`tests/fixtures/articles/${name}.readability.json`, 'utf8')) as {
    finalUrl: string
    result: ReadabilityResult
  }
const news = saved('news')
const blog = saved('blog')

function draft(result: ReadabilityResult | null, finalUrl = news.finalUrl): ArticleDraft {
  const out = draftArticle(result, finalUrl)
  if (!out.ok) throw new Error(out.problem)
  return out.draft
}

const blocks = (d: ArticleDraft): BookBlock[] => d.book.chapters.flatMap((c) => c.blocks)
const headings = (d: ArticleDraft) =>
  blocks(d).flatMap((b) =>
    b.type === 'heading' ? [[b.level, b.runs.map((r) => ('text' in r ? r.text : '')).join('')]] : [],
  )
const prose = (words: number) => `<p>${Array.from({ length: words }, (_, i) => `word${i}`).join(' ')}</p>`

describe('draftArticle over the news page', () => {
  const d = draft(news.result)

  it('takes the title, byline without "By", site, language and year', () => {
    expect(d.book).toMatchObject({
      title: 'The Quiet Return of the Night Train',
      author: 'Ada Fenwick',
      language: 'en-GB',
      cover: null,
      details: {
        description:
          'Sleeper trains are running again across Europe, and travellers are choosing them over short flights.',
        isbn: null,
        publisher: 'The Daily Fixture',
        publishedYear: 2026,
      },
    })
  })

  it('is one chapter titled by the article', () => {
    expect(d.book.chapters.map((c) => c.title)).toEqual(['The Quiet Return of the Night Train'])
  })

  it('makes h2 a section heading and h3 a subheading', () => {
    expect(headings(d)).toEqual([
      [3, 'Why travellers are choosing it'],
      [4, 'What comes next'],
    ])
  })

  it('keeps the listing’s language, which readability.ts copied to data-code-language', () => {
    expect(blocks(d).filter((b) => b.type === 'code')).toEqual([
      {
        type: 'code',
        text: 'const departs = 21 * 60 + 10\nconst arrives = 7 * 60 + 45 + 24 * 60\nconsole.log((arrives - departs) / 60)',
        lang: 'javascript',
      },
    ])
  })

  it('numbers the pictures, with the srcset’s widest candidate up to 1,600', () => {
    expect([...d.pictureUrls]).toEqual([
      [1, 'https://daily.example/2026/10/pictures/train-800.png'],
      [2, 'https://daily.example/2026/10/pictures/map.png'],
    ])
    const images = blocks(d).filter((b) => b.type === 'image')
    expect(images).toEqual([
      {
        type: 'image',
        image: 1,
        alt: 'A sleeper train waiting at a platform at dusk',
        caption: [{ text: 'The night train waits at the platform before it leaves.' }],
      },
      { type: 'image', image: 2, alt: 'A map of the new sleeper routes' },
    ])
    expect(d.capped).toBe(0)
  })
})

describe('draftArticle over the blog page', () => {
  const d = draft(blog.result, blog.finalUrl)

  it('falls back to the host for the author and publisher, and to English', () => {
    expect(d.book).toMatchObject({
      title: 'Notes on Slow Reading',
      author: 'blog.example',
      language: 'en',
      details: { publisher: 'blog.example', publishedYear: null },
    })
  })

  it('puts deeper headings at level 4', () => {
    expect(headings(d)).toEqual([
      [4, 'What changed'],
      [4, 'Small habits'],
      [4, 'A deeper note'],
    ])
  })

  it('keeps an icon in a sentence as its alt text, and takes the narrowest of wide candidates', () => {
    expect(JSON.stringify(blocks(d))).toContain('a small pencil A pencil helps.')
    expect([...d.pictureUrls.values()]).toEqual([
      'https://blog.example/images/icon.png',
      'https://blog.example/images/desk-2400.jpg',
    ])
  })
})

describe('draftArticle’s fallbacks', () => {
  const body = prose(120)
  it('takes the page’s <title> without a title, and the host without either', () => {
    expect(draft({ content: body, pageTitle: 'Page title' }).book.title).toBe('Page title')
    expect(draft({ content: body }, 'https://www.example.com/a').book.title).toBe('example.com')
  })
  it('takes the site name as the author without a byline', () => {
    expect(draft({ content: body, siteName: 'The Site' }).book.author).toBe('The Site')
  })
  it('caps the title at 300 and the author at 200', () => {
    const d = draft({ content: body, title: 'T'.repeat(400), byline: `By ${'A'.repeat(300)}` })
    expect(d.book.title).toHaveLength(300)
    expect(d.book.author).toHaveLength(200)
  })
  it('keeps a valid language tag only', () => {
    expect(draft({ content: body, lang: 'pt-BR' }).book.language).toBe('pt-BR')
    expect(draft({ content: body, lang: 'en_US' }).book.language).toBe('en')
  })
  it('drops a first heading that repeats the title, but not a later one', () => {
    const d = draft({ title: 'Same', content: `<h1>Same</h1>${body}<h2>Same</h2><h2></h2>` })
    expect(headings(d)).toEqual([[3, 'Same']])
  })
})

describe('draftArticle’s pictures', () => {
  const body = prose(120)
  it('keeps 40 and counts the rest', () => {
    const imgs = Array.from({ length: 45 }, (_, i) => `<img src="/p${i}.png" alt="">`).join('')
    const d = draft({ content: `${body}${imgs}<img src="/p0.png">` })
    expect(d.pictureUrls.size).toBe(40)
    expect(d.capped).toBe(5)
    expect(d.pictureUrls.get(40)).toBe('https://daily.example/p39.png')
  })
  it('leaves out SVG diagrams and addresses that aren’t on the web, keeping a caption', () => {
    const d = draft({
      content: `${body}<figure><svg><circle r="4"/></svg><figcaption>A diagram</figcaption></figure><img src="data:image/png;base64,AAAA"><img src="">`,
    })
    expect(d.pictureUrls.size).toBe(0)
    expect(blocks(d).filter((b) => b.type === 'image')).toEqual([
      { type: 'image', image: 1, alt: '', caption: [{ text: 'A diagram' }] },
    ])
  })
  it('leaves out an address that isn’t one', () => {
    const d = draft({ content: `${body}<img src="http://[bad/p.png" alt="x">` })
    expect(d.pictureUrls.size).toBe(0)
  })
  it('drops a spacer by its attributes', () => {
    const d = draft({ content: `${body}<img src="/pixel.gif" width="1" height="1">` })
    expect(blocks(d).some((b) => b.type === 'image')).toBe(false)
  })
})

describe('draftArticle refuses', () => {
  it('no result, no content, and under 500 characters', () => {
    expect(draftArticle(null, news.finalUrl)).toEqual({ ok: false, problem: 'no_article' })
    expect(draftArticle({ title: 'x' }, news.finalUrl)).toEqual({ ok: false, problem: 'no_article' })
    expect(draftArticle({ content: '<p>Too short.</p><nav>skipped</nav>' }, news.finalUrl)).toEqual({
      ok: false,
      problem: 'no_article',
    })
  })
  it('counts the text of every kind of block', () => {
    const many =
      '<blockquote><p>q</p></blockquote><ul><li>i<ul><li>n</li></ul></li></ul><table><tr><td>c</td></tr></table><pre>code</pre>'
    expect(draftArticle({ content: `${many}${'<p>x</p>'.repeat(10)}` }, news.finalUrl).ok).toBe(false)
    expect(draftArticle({ content: `${many}<pre>${'x'.repeat(600)}</pre>` }, news.finalUrl).ok).toBe(true)
  })
})

describe('the XSS corpus', () => {
  it.each(XSS_CORPUS)('%s leaves nothing that can run', (_name, payload) => {
    const out = draftArticle({ content: `${prose(120)}${payload}` }, news.finalUrl)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const html = renderBlocks(blocks(out.draft), {
      imageSrc: (n) => `/account/books/x/images/${n}`,
      imageSize: () => ({ width: 100, height: 100 }),
    })
      .map((b) => b.html)
      .join('')
    expect(html).not.toMatch(
      /<(script|iframe|object|embed|form|input|button|textarea|base|meta|svg|math|style|template)\b/i,
    )
    expect(html).not.toMatch(/\son\w+\s*=|javascript:|vbscript:|data:|srcdoc|style=/i)
    expect([...out.draft.pictureUrls.values()].every((u) => u.startsWith('https://'))).toBe(true)
  })
})
