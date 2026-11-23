import { pageLabel } from '~/shared/content/navigation'

export interface Place {
  chapter: number
  page: number
}

export interface Passage extends Place {
  text: string
}

const at = (chapter: number, page: number, text: string): Passage => ({ chapter, page, text })

export const label = (p: Place) => pageLabel({ chapterIndex: p.chapter - 1, page: p.page })

export const BOOK_TITLE = 'Pride and Prejudice'
export const BOOK_FILE = 'pride-and-prejudice.epub'
export const CHAPTER_COUNT = 61

export const OPENING = [
  at(
    1,
    1,
    'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.',
  ),
  at(
    1,
    1,
    'However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered as the rightful property of some one or other of their daughters.',
  ),
  at(
    1,
    1,
    '“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”',
  ),
  at(1, 1, 'Mr. Bennet replied that he had not.'),
  at(1, 1, '“But it is,” returned she; “for Mrs. Long has just been here, and she told me all about it.”'),
] as const

export const READER_ASK = {
  question: 'Why does Mrs. Bennet care who rents Netherfield?',
  answer: 'Because the new tenant is single and rich, and she has five daughters to marry. As she tells her husband,',
  quote: at(1, 1, 'You must know that I am thinking of his marrying one of them.'),
  scope: { chapter: 1, page: 1 },
} as const

export const READ_ALOUD = { chapter: 3, title: 'Chapter 3', minutesLeft: 11 } as const

export const FEATURE_ASK = {
  scope: { chapter: 4, page: 2 },
  question: 'Is Mr. Darcy as proud as everyone says?',
  answer: 'The room thinks so by the end of his first evening: his manners turn the tide of his popularity, and he is',
  quote: at(3, 1, 'discovered to be proud, to be above his company, and above being pleased'),
} as const

export const HIGHLIGHTS = {
  count: 12,
  items: [
    {
      passage: OPENING[0],
      color: 'yellow',
      note: 'The whole plot in one sentence, said with a straight face.',
    },
    {
      passage: at(3, 2, 'She is tolerable; but not handsome enough to tempt me'),
      color: 'pink',
      note: null,
    },
  ],
} as const
