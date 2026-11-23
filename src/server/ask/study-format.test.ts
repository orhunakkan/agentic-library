import { describe, expect, it } from 'vitest'
import { citationMarker } from '~/shared/ask/events'
import { BACK_CHARS, FRONT_CHARS, readStudy, type StudyBlock, type StudyCitation, WHY_CHARS } from './study-format'

const keep = (n: number) => n - 1
const cite = (page: number, text = `Passage on page ${page}.`): StudyCitation => ({
  pageHref: `/read/b/one/${page}`,
  label: `Ch. 1 · p. ${page}`,
  citedText: text,
  pageIndex: page - 1,
})
const plain = (text: string): StudyBlock => ({ text, citations: [] })

function quizItem(n: number, over: Partial<Record<'q' | 'a' | 'b' | 'c' | 'd' | 'answer' | 'why', string>> = {}) {
  const v = {
    q: `What is question ${n} about?`,
    a: `First choice ${n}`,
    b: `Second choice ${n}`,
    c: `Third choice ${n}`,
    d: `Fourth choice ${n}`,
    answer: 'B',
    why: `Because the page says so (${n}).`,
    ...over,
  }
  return `QUESTION: ${v.q}\nA) ${v.a}\nB) ${v.b}\nC) ${v.c}\nD) ${v.d}\nANSWER: ${v.answer}\nWHY: ${v.why}`
}
const quiz = (...parts: string[]) => [plain(parts.join('\n\n'))]

describe('readStudy, a quiz', () => {
  it('reads five valid questions', () => {
    const read = readStudy(quiz(...[1, 2, 3, 4, 5].map((n) => quizItem(n))), 'quiz', keep)
    expect(read && 'questions' in read && read.questions).toHaveLength(5)
    if (!read || !('questions' in read)) throw new Error('no quiz')
    expect(read.questions[0]).toEqual({
      question: 'What is question 1 about?',
      choices: ['First choice 1', 'Second choice 1', 'Third choice 1', 'Fourth choice 1'],
      answer: 1,
      why: 'Because the page says so (1).',
      citations: [],
    })
  })

  it('takes bold labels, a lower-case answer, `A.` choices and ignores a preamble and a closing line', () => {
    const odd = [
      '**QUESTION:** Who arrives first?',
      '**A.** Jane',
      '**B.** Lydia',
      'c. Kitty',
      'D. Mary',
      '**ANSWER:** b',
      '**Why**: She came by the early coach.',
    ].join('\n')
    const read = readStudy(
      quiz('Here is your quiz:', odd, quizItem(2), quizItem(3), 'I hope this helps!'),
      'quiz',
      keep,
    )
    if (!read || !('questions' in read)) throw new Error('no quiz')
    expect(read.questions).toHaveLength(3)
    expect(read.questions[0]).toMatchObject({
      question: 'Who arrives first?',
      choices: ['Jane', 'Lydia', 'Kitty', 'Mary'],
      answer: 1,
      why: 'She came by the early coach.',
    })
    expect(read.questions[2]?.why).toBe('Because the page says so (3).')
  })

  it('drops a question that breaks a rule, and keeps the rest', () => {
    const broken = [
      quizItem(1).replace(/\nD\) .*/, ''),
      quizItem(2, { c: 'First choice 2' }),
      quizItem(3).replace(/\nANSWER: .*/, ''),
      quizItem(4, { answer: 'E' }),
      quizItem(5, { q: 'x'.repeat(301) }),
      quizItem(6, { a: 'y'.repeat(201) }),
      quizItem(7, { why: 'z'.repeat(WHY_CHARS + 1) }),
      `${quizItem(8)}\nANSWER: C`,
      quizItem(9, { answer: 'Both' }),
    ]
    expect(readStudy(quiz(...broken, quizItem(10), quizItem(11)), 'quiz', keep)).toBeNull()
    const read = readStudy(quiz(...broken, quizItem(10), quizItem(11), quizItem(12)), 'quiz', keep)
    if (!read || !('questions' in read)) throw new Error('no quiz')
    expect(read.questions.map((q) => q.question)).toEqual([10, 11, 12].map((n) => `What is question ${n} about?`))
  })

  it('counts lengths in characters, not UTF-16 units', () => {
    const read = readStudy(quiz(quizItem(1, { q: '🙂'.repeat(300) }), quizItem(2), quizItem(3)), 'quiz', keep)
    if (!read || !('questions' in read)) throw new Error('no quiz')
    expect(read.questions).toHaveLength(3)
  })

  it('keeps the first five of six, and is null with two left', () => {
    const six = readStudy(quiz(...[1, 2, 3, 4, 5, 6].map((n) => quizItem(n))), 'quiz', keep)
    expect(six && 'questions' in six && six.questions.map((q) => q.question)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `What is question ${n} about?`),
    )
    expect(readStudy(quiz(quizItem(1), quizItem(2)), 'quiz', keep)).toBeNull()
    expect(readStudy([plain('The book is about manners.')], 'quiz', keep)).toBeNull()
  })

  it('reads a reason that runs onto more lines, and a question with a blank line before its choices', () => {
    const spaced = quizItem(1, { why: 'It runs on\nonto the next line\nand one more.' }).replace('\nA)', '\n\nA)')
    const read = readStudy(quiz(spaced, quizItem(2), quizItem(3)), 'quiz', keep)
    if (!read || !('questions' in read)) throw new Error('no quiz')
    expect(read.questions[0]?.why).toBe('It runs on onto the next line and one more.')
    expect(read.questions[0]?.choices[0]).toBe('First choice 1')
  })

  it('drops a last question cut off by max_tokens', () => {
    const cut = quizItem(4).slice(0, quizItem(4).indexOf('ANSWER'))
    const read = readStudy(quiz(quizItem(1), quizItem(2), quizItem(3), cut), 'quiz', keep)
    expect(read && 'questions' in read && read.questions).toHaveLength(3)
  })

  it('gives each question the citations of the blocks that start inside it, without duplicates', () => {
    const first = quizItem(1)
    const blocks: StudyBlock[] = [
      plain(first.slice(0, first.indexOf('page says'))),
      { text: 'page says so', citations: [cite(3), cite(3)] },
      { text: ' (1).', citations: [cite(4)] },
      { text: `\n\n${quizItem(2)}`, citations: [cite(7)] },
      plain(`\n\n${quizItem(3)}`),
    ]
    const read = readStudy(blocks, 'quiz', keep)
    if (!read || !('questions' in read)) throw new Error('no quiz')
    expect(read.questions[0]?.citations).toEqual([cite(3), cite(4)])
    expect(read.questions[0]?.why).toBe(`Because the page says so (1).${citationMarker(0)}${citationMarker(1)}`)
    expect(read.questions[1]?.citations).toEqual([cite(7)])
    expect(read.questions[2]?.citations).toEqual([])
  })

  it('takes out marker characters the model wrote, so it cannot place a chip itself', () => {
    const read = readStudy(quiz(quizItem(1, { why: `Sneaky${citationMarker(0)}.` }), quizItem(2), quizItem(3)), 'quiz')
    expect(read && 'questions' in read && read.questions[0]?.why).toBe('Sneaky0.')
  })

  it('shuffles the choices with the rng, moving the answer with its choice', () => {
    const picks = [0, 0, 1]
    const rng = (n: number) => picks.shift() ?? n - 1
    const read = readStudy(quiz(quizItem(1, { answer: 'C' }), quizItem(2), quizItem(3)), 'quiz', rng)
    if (!read || !('questions' in read)) throw new Error('no quiz')
    const q = read.questions[0]
    expect(q?.choices).toEqual(['Third choice 1', 'Second choice 1', 'Fourth choice 1', 'First choice 1'])
    expect(q?.choices[q.answer]).toBe('Third choice 1')
  })
})

const cardItem = (n: number, front = `Term ${n}`, back = `What term ${n} means.`) => `FRONT: ${front}\nBACK: ${back}`
const cards = (...parts: string[]) => [plain(parts.join('\n\n'))]
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

describe('readStudy, flashcards', () => {
  it('reads cards, the first ten of more, and null under four', () => {
    const eight = readStudy(cards(...range(1, 8).map((n) => cardItem(n))), 'cards')
    expect(eight && 'cards' in eight && eight.cards[0]).toEqual({
      front: 'Term 1',
      back: 'What term 1 means.',
      citations: [],
    })
    const twelve = readStudy(cards(...range(1, 12).map((n) => cardItem(n))), 'cards')
    expect(twelve && 'cards' in twelve && twelve.cards).toHaveLength(10)
    expect(readStudy(cards(...range(1, 3).map((n) => cardItem(n))), 'cards')).toBeNull()
  })

  it('drops a card over the limits or without a back, and takes a back that runs onto more lines', () => {
    const read = readStudy(
      cards(
        cardItem(1, 'f'.repeat(FRONT_CHARS + 1)),
        cardItem(2, 'Term 2', 'b'.repeat(BACK_CHARS + 1)),
        'FRONT: No back',
        cardItem(4, '**Term 4**', 'One line\nand another'),
        ...range(5, 7).map((n) => cardItem(n)),
      ),
      'cards',
    )
    if (!read || !('cards' in read)) throw new Error('no cards')
    expect(read.cards.map((c) => c.front)).toEqual(['Term 4', 'Term 5', 'Term 6', 'Term 7'])
    expect(read.cards[0]?.back).toBe('One line and another')
  })

  it('ignores quiz labels in a set of cards, and card labels in a quiz', () => {
    expect(readStudy(quiz(quizItem(1), quizItem(2), quizItem(3), quizItem(4)), 'cards')).toBeNull()
    expect(readStudy(cards(...range(1, 8).map((n) => cardItem(n))), 'quiz')).toBeNull()
  })

  it('cites each card from its own blocks', () => {
    const blocks: StudyBlock[] = [
      plain('FRONT: Term 1\nBACK: It means '),
      { text: 'this', citations: [cite(2)] },
      plain(
        `.\n\n${range(2, 4)
          .map((n) => cardItem(n))
          .join('\n\n')}`,
      ),
    ]
    const read = readStudy(blocks, 'cards')
    if (!read || !('cards' in read)) throw new Error('no cards')
    expect(read.cards[0]).toEqual({ front: 'Term 1', back: `It means this.${citationMarker(0)}`, citations: [cite(2)] })
    expect(read.cards[1]?.citations).toEqual([])
  })
})
