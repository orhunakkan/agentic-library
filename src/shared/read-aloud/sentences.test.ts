import { describe, expect, it } from 'vitest'
import { servedBooks } from '../../../tests/fixtures/served-books'
import {
  CODE_SAY,
  chapterIntro,
  cutLong,
  fallbackSentences,
  MAX_UTTERANCE,
  sentenceSpans,
  utterances,
} from './sentences.ts'
import { chapterPageBlocks, pagedPageBlocks, type SpeechPageText } from './speech-text.ts'

const sentences = (text: string, lang = 'en', intl = true) =>
  sentenceSpans(text, lang, { intl }).map(([a, b]) => text.slice(a, b).trim())

const said = (html: string, lang = 'en') => utterances(chapterPageBlocks(html), lang).map((u) => u.say)

describe('sentenceSpans', () => {
  it('keeps abbreviations, decimals and title abbreviations inside a sentence', () => {
    expect(sentences('Use a list, e.g. an array. Mr. Smith said so. Pi is 3.14 or so. Dr. Who? Yes.')).toEqual([
      'Use a list, e.g. an array.',
      'Mr. Smith said so.',
      'Pi is 3.14 or so.',
      'Dr. Who?',
      'Yes.',
    ])
  })

  it('ends a sentence after closing quotes and brackets, and joins a quoted question to what follows', () => {
    expect(sentences('He said “stop.” Then he left. (It was late.) “Is it?” she asked. Go!')).toEqual([
      'He said “stop.”',
      'Then he left.',
      '(It was late.)',
      '“Is it?” she asked.',
      'Go!',
    ])
  })

  it('splits without Intl.Segmenter after . ! or ? and a space, with the same joins', () => {
    expect(sentences('One. Two! “Three?” said he. Mr. Four, e.g. five. 3.14 stays', 'en', false)).toEqual([
      'One.',
      'Two!',
      '“Three?” said he.',
      'Mr. Four, e.g. five.',
      '3.14 stays',
    ])
    expect(fallbackSentences('')).toEqual([])
    expect(fallbackSentences('No end')).toEqual([[0, 6]])
  })

  it('follows the rules of a non-English language, and survives a malformed tag', () => {
    expect(sentences('Bu bir cümle. Bu da ikincisi.', 'tr')).toEqual(['Bu bir cümle.', 'Bu da ikincisi.'])
    expect(sentences('Eins. Zwei.', 'not a tag!')).toEqual(['Eins.', 'Zwei.'])
  })
})

describe('cutLong', () => {
  const long = (pieces: string[]) => pieces.join('')

  it('leaves a sentence of up to 200 characters whole', () => {
    const text = 'a'.repeat(MAX_UTTERANCE)
    expect(cutLong(text, 0, text.length)).toEqual([[0, MAX_UTTERANCE]])
  })

  it('cuts at the last clause mark before the limit', () => {
    const text = long(['x'.repeat(120), ', ', 'y'.repeat(60), '; ', 'z'.repeat(80), '.'])
    const pieces = cutLong(text, 0, text.length).map(([a, b]) => text.slice(a, b))
    expect(pieces).toEqual([`${'x'.repeat(120)}, ${'y'.repeat(60)};`, `${'z'.repeat(80)}.`])
  })

  it('cuts at the last space when there is no clause mark, and at the limit when there is no space', () => {
    const words = Array.from({ length: 60 }, () => 'word').join(' ')
    const pieces = cutLong(words, 0, words.length).map(([a, b]) => words.slice(a, b))
    expect(pieces.every((p) => p.length <= MAX_UTTERANCE && !p.startsWith(' ') && !p.endsWith(' '))).toBe(true)
    expect(pieces.join(' ')).toBe(words)
    const solid = 'q'.repeat(450)
    expect(cutLong(solid, 0, solid.length)).toEqual([
      [0, 200],
      [200, 400],
      [400, 450],
    ])
  })

  it('never cuts a surrogate pair in two', () => {
    const text = `${'q'.repeat(199)}😀${'q'.repeat(10)}`
    const [first] = cutLong(text, 0, text.length)
    expect(first).toEqual([0, 199])
  })
})

describe('utterances', () => {
  it('says each sentence, marking it in page-text offsets without the whitespace around it', () => {
    const page = chapterPageBlocks('<p>  First one.   Second one. </p><h3>Next</h3>')
    const list = utterances(page, 'en')
    expect(list.map((u) => [page.text.slice(u.start, u.end), u.say, u.kind])).toEqual([
      ['First one.', 'First one.', 'text'],
      ['Second one.', 'Second one.', 'text'],
      ['Next', 'Next', 'heading'],
    ])
  })

  it('collapses whitespace runs and no-break spaces in what is said, but not in the offsets', () => {
    const page = chapterPageBlocks('<p>A  long\n\tline  here.</p>')
    const [u] = utterances(page, 'en')
    expect(u?.say).toBe('A long line here.')
    expect(u && page.text.slice(u.start, u.end)).toBe('A  long\n\tline  here.')
  })

  it('says "Code example." for a code block and marks the whole block, while inline code is read', () => {
    const page = chapterPageBlocks('<p>Run <code>let x = 1</code> now.</p><pre>\nlet x = 1\nx++\n</pre><p>Done.</p>')
    const list = utterances(page, 'en')
    expect(list.map((u) => u.say)).toEqual(['Run let x = 1 now.', CODE_SAY, 'Done.'])
    const code = list[1]
    expect(code && page.text.slice(code.start, code.end)).toBe('let x = 1\nx++')
    expect(code?.kind).toBe('code')
  })

  it('cuts a long sentence into pieces of at most 200 characters, each marked on its own', () => {
    const sentence = `${'Values and types, '.repeat(20).trim()}.`
    const list = utterances(chapterPageBlocks(`<p>${sentence}</p>`), 'en')
    expect(list.length).toBeGreaterThan(1)
    expect(list.every((u) => u.end - u.start <= MAX_UTTERANCE)).toBe(true)
    expect(list.map((u) => u.say).join(' ')).toBe(sentence)
  })

  it('drops pieces that hold no letter or digit', () => {
    expect(said('<p>—</p><p>* * *</p><p>Real.</p><pre>   </pre>')).toEqual(['Real.'])
  })

  it('reads a list item and a table cell each on its own', () => {
    expect(said('<ul><li>One</li><li>Two</li></ul><table><tr><td>a</td><td>1</td></tr></table>')).toEqual([
      'One',
      'Two',
      'a',
      '1',
    ])
  })
})

describe('chapterIntro', () => {
  it('names the chapter by number and title, ending with a full stop', () => {
    expect(chapterIntro({ number: 3, title: 'Functions' })).toBe('Chapter 3. Functions.')
    expect(chapterIntro({ number: 1, title: 'What  now?' })).toBe('Chapter 1. What now?')
  })

  it('says the number once when the title is only the number', () => {
    expect(chapterIntro({ number: 1, title: 'Chapter 1' })).toBe('Chapter 1.')
    expect(chapterIntro({ number: 2, title: 'chapter  2.' })).toBe('Chapter 2.')
    expect(chapterIntro({ number: 2, title: 'Chapter 3' })).toBe('Chapter 2. Chapter 3.')
  })

  it('says a paged chapter by its title alone', () => {
    expect(chapterIntro({ number: null, title: 'Introduction' })).toBe('Introduction.')
  })
})

function expectCovered(page: SpeechPageText, lang: string, where: string) {
  const list = utterances(page, lang)
  const covered = new Uint8Array(page.text.length)
  for (const u of list) {
    expect(u.end - u.start, where).toBeLessThanOrEqual(MAX_UTTERANCE * (u.kind === 'code' ? 1000 : 1))
    covered.fill(1, u.start, u.end)
  }
  for (const b of page.blocks) {
    for (let i = b.start; i < b.end; i++) {
      if (!covered[i] && /[\p{L}\p{N}]/u.test(page.text[i] ?? '')) {
        throw new Error(`${where}: "${page.text.slice(Math.max(0, i - 20), i + 20)}" is never said`)
      }
    }
  }
  return list.length
}

describe('every page the app serves', () => {
  it('splits into utterances of at most 200 characters, with no letter left unsaid', () => {
    let count = 0
    for (const { file, book } of servedBooks()) {
      if (book.kind === 'chapter') {
        for (const chapter of book.chapters) {
          for (const [i, html] of chapter.pages.entries())
            count += expectCovered(chapterPageBlocks(html), 'en', `${file} ${chapter.slug} p.${i + 1}`)
        }
      } else {
        for (const p of book.pages) count += expectCovered(pagedPageBlocks(p.blocks), 'en', `${file} p.${p.pageNumber}`)
      }
    }
    expect(count).toBeGreaterThan(5000)
  })
})
