import type { ChapterProblem } from '~/shared/import/draft'
import { MAX_BOOKS, MAX_CHAPTERS } from '~/shared/import/limits'
import type { ImportProblem } from './import-client'
import type { PrivateBookResult } from './private-book-save'

/** What a reader at the book limit is told, whether they pick a book or an audiobook. */
export const BOOK_QUOTA_TEXT = `You have ${MAX_BOOKS} of your own books. Delete one to import another.`

export const IMPORT_PROBLEM_TEXT: Record<ImportProblem, string> = {
  quota: BOOK_QUOTA_TEXT,
  'quota-user': 'This book’s pictures no longer fit the room left in your library. Choose the file again to review it.',
  rate: 'You’ve imported 10 books in the last hour. Try again later.',
  'book-too-large': 'This book is over 8 MB of text, the most a book can hold. Drop some chapters and try again.',
  'request-too-large': 'A chapter is too long to upload. Drop it, or merge less into it, and try again.',
  'too-long': 'Part of this book is longer than the importer allows. Drop the chapter it is in and try again.',
  empty: 'A chapter has no text the reader can show. Drop it and try again.',
  invalid: 'The book couldn’t be saved as it is. Check the title, author and language, then try again.',
  'signed-out': 'You’ve been signed out. Sign in again, then import the book again.',
  'not-found': 'The import was interrupted. Try again.',
  incomplete: 'The import was interrupted. Try again.',
  failed: 'Something went wrong while saving. Try again in a few minutes.',
}

export const SAVE_FAILED = IMPORT_PROBLEM_TEXT.failed

export const PICTURE_FAILED =
  'A picture couldn’t be saved, so the book wasn’t imported. Try again, or tell the owner if it keeps happening.'

export const BAD_ISBN = 'Not a valid ISBN.'

const CHECK_TEXT: Record<ChapterProblem, string> = {
  none: 'Keep at least one chapter.',
  'too-many': `A book can have at most ${MAX_CHAPTERS} chapters. Merge some first.`,
  oversized: IMPORT_PROBLEM_TEXT['request-too-large'],
}

export type ImportSaveFailure =
  | { ok: false; problem: ChapterProblem }
  | Exclude<PrivateBookResult<{ ok: false; problem: ImportProblem }>, { ok: true }>

const problemText = (problem: ImportProblem) => IMPORT_PROBLEM_TEXT[problem] ?? SAVE_FAILED

export function importSaveText(failure: ImportSaveFailure): string {
  if (!('at' in failure)) return CHECK_TEXT[failure.problem]
  if (failure.at === 'start') return problemText(failure.refused.problem)
  if (failure.at === 'picture') return PICTURE_FAILED
  return problemText(failure.problem)
}
