import type { OtherAudio } from '~/shared/audiobooks/sniff'
import { bookQuotaCopy, proNotice } from '~/shared/plans/copy'
import { FREE_LIMITS, PRO_LIMITS } from '~/shared/plans/plans'

export type AudiobookProblem =
  | {
      code:
        | 'mixed'
        | 'drm'
        | 'aax'
        | 'large'
        | 'files'
        | 'chapters'
        | 'long'
        | 'room'
        | 'off'
        | 'server-full'
        | 'books'
        | 'books-free'
        | 'pro'
        | 'rate'
        | 'signed-out'
        | 'interrupted'
        | 'invalid'
        | 'stopped'
        | 'failed'
    }
  | { code: 'type'; type: OtherAudio | null }
  | { code: 'unreadable'; reason: string }
  | { code: 'server-unreadable'; reason: string }

export type ProblemCode = AudiobookProblem['code']

const sentence = (reason: string) => `${reason.trim().replace(/[.\s]+$/, '')}.`

export function problemText(problem: AudiobookProblem): string {
  switch (problem.code) {
    case 'mixed':
      return 'Pick one M4B file, or the MP3 files of one audiobook.'
    case 'drm':
      return 'This audiobook is copy-protected (DRM), so Folio can’t play it. Folio imports M4B and MP3 files without DRM.'
    case 'aax':
      return 'Audible’s AAX files are copy-protected (DRM), so Folio can’t play them.'
    case 'type':
      return `Folio imports audiobooks as M4B or MP3 files. This one is ${problem.type ?? 'not an audio file'}.`
    case 'large':
      return 'This audiobook is larger than 2 GB.'
    case 'files':
      return 'An audiobook can have at most 500 MP3 files.'
    case 'chapters':
      return 'This audiobook has more than 1,000 chapters.'
    case 'long':
      return 'One of this audiobook’s chapters is longer than 24 hours.'
    case 'room':
      return 'Your audiobooks would go over 8 GB. Delete one to make room.'
    case 'unreadable':
      return `This file couldn’t be read: ${sentence(problem.reason)}`
    case 'off':
      return 'Audiobook imports aren’t turned on for this server yet.'
    case 'server-full':
      return 'The server is short of space for audiobooks right now. Try again later.'
    case 'books':
      return bookQuotaCopy('pro', PRO_LIMITS.books)
    case 'books-free':
      return bookQuotaCopy('free', FREE_LIMITS.books)
    case 'pro':
      return proNotice('audiobooks').heading
    case 'rate':
      return 'You’ve imported 10 books in the last hour. Try again later.'
    case 'server-unreadable':
      return `Folio couldn’t read this audiobook on the server: ${sentence(problem.reason)}`
    case 'signed-out':
      return 'You’ve been signed out. Sign in again, then import the audiobook again.'
    case 'interrupted':
      return 'The import was interrupted. Try again.'
    case 'invalid':
      return 'The audiobook couldn’t be saved as it is. Check the title, author and language, then try again.'
    case 'stopped':
      return 'The upload stopped. Check your connection, then press Resume.'
    case 'failed':
      return 'Something went wrong while saving. Try again in a few minutes.'
  }
}

export const problem = (code: Exclude<ProblemCode, 'type' | 'unreadable' | 'server-unreadable'>): AudiobookProblem => ({
  code,
})

export const isResumable = (p: AudiobookProblem) => p.code === 'stopped'
