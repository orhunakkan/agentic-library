import { describe, expect, it } from 'vitest'
import { citationMarker as cite } from '../ask/answer-format'
import { answerSpeech, createSpeechFeed } from './answer-speech'

const ANSWER = [
  `Mr. Darcy is proud because of his rank${cite(0)}. He says so at the assembly${cite(1)}.`,
  '',
  'He gives **three** reasons:',
  '',
  '- his `income`, which is large',
  '- his family. It is old',
  '- his pride itself',
  '',
  '```js',
  'const proud = true',
  '```',
  '',
  `“Is it pride?” she asked. Elizabeth thinks so${cite(2)}.`,
].join('\n')

function fedByCharacter(text: string, lang = 'en'): string[] {
  const feed = createSpeechFeed(lang)
  const out: string[] = []
  for (let i = 1; i <= text.length; i++) out.push(...feed.push(text.slice(0, i)))
  return [...out, ...feed.end()]
}

describe('answerSpeech', () => {
  it('says the prose without citation markers, emphasis marks or code marks, and a code block as Code example.', () => {
    expect(answerSpeech(ANSWER, 'en')).toEqual([
      'Mr. Darcy is proud because of his rank.',
      'He says so at the assembly.',
      'He gives three reasons:',
      'his income, which is large',
      'his family.',
      'It is old',
      'his pride itself',
      'Code example.',
      '“Is it pride?” she asked.',
      'Elizabeth thinks so.',
    ])
  })

  it('cuts a long sentence into pieces of at most 200 characters', () => {
    const long = `${'word '.repeat(40)}and then, ${'more words '.repeat(25)}end.`
    expect(long.length).toBeGreaterThan(400)
    const said = answerSpeech(long, 'en')
    expect(said.length).toBeGreaterThan(2)
    for (const piece of said) expect(piece.length).toBeLessThanOrEqual(200)
    expect(said.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' '))
  })

  it('says no mark the parse left in place, as in a stream cut off inside bold or code', () => {
    expect(answerSpeech('He has **three', 'en')).toEqual(['He has three'])
    expect(answerSpeech('Call `parse', 'en')).toEqual(['Call parse'])
  })

  it('says nothing for an empty answer, an empty code block or a citation alone', () => {
    expect(answerSpeech('', 'en')).toEqual([])
    expect(answerSpeech('```\n```', 'en')).toEqual([])
    expect(answerSpeech(cite(0), 'en')).toEqual([])
  })
})

describe('createSpeechFeed', () => {
  it('fed one character at a time, says exactly what answerSpeech says of the whole', () => {
    expect(fedByCharacter(ANSWER)).toEqual(answerSpeech(ANSWER, 'en'))
  })

  it('fed the stub answer one character at a time matches too', () => {
    const stub = `I can see 12 pages of the book. Your page says so${cite(0)}.\n\nFor example:\n\n\`\`\`js\nconst answer = 42\n\`\`\``
    expect(fedByCharacter(stub)).toEqual([
      'I can see 12 pages of the book.',
      'Your page says so.',
      'For example:',
      'Code example.',
    ])
  })

  it('says a sentence once the next one has begun, not before', () => {
    const feed = createSpeechFeed('en')
    expect(feed.push('First sentence.')).toEqual([])
    expect(feed.push('First sentence. ')).toEqual([])
    expect(feed.push('First sentence. S')).toEqual(['First sentence.'])
    expect(feed.push('First sentence. Second')).toEqual([])
  })

  it('waits past a break that a lower-case word could still join', () => {
    const feed = createSpeechFeed('en')
    expect(feed.push('“Is it?” ')).toEqual([])
    expect(feed.push('“Is it?” s')).toEqual([])
    expect(feed.end()).toEqual(['“Is it?” s'])
  })

  it('says a paragraph’s last sentence when the paragraph ends', () => {
    const feed = createSpeechFeed('en')
    expect(feed.push('Only one sentence here.')).toEqual([])
    expect(feed.push('Only one sentence here.\n\nN')).toEqual(['Only one sentence here.'])
  })

  it('end() flushes an unfinished last sentence, once', () => {
    const feed = createSpeechFeed('en')
    feed.push('It was the stub. And then it stop')
    expect(feed.end()).toEqual(['And then it stop'])
    expect(feed.end()).toEqual([])
  })

  it('says a code block once it is closed and something follows, or the answer ends', () => {
    const feed = createSpeechFeed('en')
    expect(feed.push('```js\nconst a = 1\n```')).toEqual([])
    expect(feed.end()).toEqual(['Code example.'])
  })
})
