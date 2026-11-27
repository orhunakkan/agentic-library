import { describe, expect, it } from 'vitest'
import { cleanDescription, NO_DETAILS, paragraphs, yearFrom } from '~/shared/import/details'

describe('cleanDescription', () => {
  it('strips HTML tags, keeps its paragraphs and decodes entities', () => {
    const html =
      '<p>It is a truth <em>universally</em>\n acknowledged&#8212;</p><p>Mr &amp; Mrs Bennet&nbsp;argue.<br/>Again.</p>'
    expect(cleanDescription(html)).toBe('It is a truth universally acknowledged—\n\nMr & Mrs Bennet argue. Again.')
  })

  it('keeps an entity named like an Object.prototype property as written', () => {
    expect(cleanDescription('<p>Hello &constructor; world</p>')).toBe('Hello &constructor; world')
  })

  it('reads HTML that was escaped once more, as an OPF may carry it', () => {
    expect(cleanDescription('&lt;p&gt;&lt;i&gt;Pride&lt;/i&gt; &amp;amp; more&lt;/p&gt;&lt;p&gt;Two&lt;/p&gt;')).toBe(
      'Pride & more\n\nTwo',
    )
  })

  it('keeps blank-line paragraphs in text that is mostly plain with a stray tag', () => {
    expect(cleanDescription('One <b>line</b>\nwrapped.\n\nTwo.')).toBe('One line wrapped.\n\nTwo.')
  })

  it('drops scripts and styles with their contents', () => {
    expect(cleanDescription('<script>alert(1)</script><style>p{}</style><p>Safe</p>')).toBe('Safe')
  })

  it('reduces Markdown links to their text and drops images and reference definitions', () => {
    const md = 'Read [the novel](https://example.com) and [more][1]. ![a cover](c.jpg)\n\n[1]: https://example.org'
    expect(cleanDescription(md)).toBe('Read the novel and more.')
  })

  it('keeps blank lines as paragraph breaks and collapses whitespace inside paragraphs', () => {
    expect(cleanDescription('One  line\r\nand   the next.\r\n\r\n\r\n  Second\tparagraph. ')).toBe(
      'One line and the next.\n\nSecond paragraph.',
    )
  })

  it('leaves text that only looks like a comparison alone', () => {
    expect(cleanDescription('Ages 3 < 5 and 7 > 4')).toBe('Ages 3 < 5 and 7 > 4')
  })

  it('cuts at a word boundary before 4,000 characters, with an ellipsis', () => {
    const long = 'word '.repeat(1000)
    const cleaned = cleanDescription(long) as string
    expect(cleaned.length).toBeLessThanOrEqual(4000)
    expect(cleaned.endsWith('word…')).toBe(true)
    expect(cleanDescription(long, { cap: false })?.length).toBe(4999)
    expect(cleanDescription('x'.repeat(5000))?.length).toBe(4000)
  })

  it('is null for nothing, or nothing left after cleaning', () => {
    expect(cleanDescription(null)).toBeNull()
    expect(cleanDescription(undefined)).toBeNull()
    expect(cleanDescription('')).toBeNull()
    expect(cleanDescription('<p> </p>\n\n<br>')).toBeNull()
  })
})

describe('yearFrom', () => {
  const now = new Date('2026-11-05T00:00:00Z')

  it('reads the first four-digit year of each form', () => {
    expect(yearFrom('2019', now)).toBe(2019)
    expect(yearFrom('2019-03-01', now)).toBe(2019)
    expect(yearFrom('March 2019', now)).toBe(2019)
    expect(yearFrom('c. 1813', now)).toBe(1813)
    expect(yearFrom('2014-06-01T00:00:00Z', now)).toBe(2014)
  })

  it('takes next year but not the one after, and is null without a year', () => {
    expect(yearFrom('2027', now)).toBe(2027)
    expect(yearFrom('2028', now)).toBeNull()
    expect(yearFrom('12345', now)).toBeNull()
    expect(yearFrom('no year', now)).toBeNull()
    expect(yearFrom(null, now)).toBeNull()
    expect(yearFrom('1999')).toBe(1999)
  })
})

describe('paragraphs', () => {
  it('splits on blank lines', () => {
    expect(paragraphs('One.\n\nTwo.\n \nThree.')).toEqual(['One.', 'Two.', 'Three.'])
  })
})

describe('NO_DETAILS', () => {
  it('has every detail empty', () => {
    expect(Object.values(NO_DETAILS).every((v) => v === null)).toBe(true)
  })
})
