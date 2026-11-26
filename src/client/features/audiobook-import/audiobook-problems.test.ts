import { describe, expect, it } from 'vitest'
import { type AudiobookProblem, isResumable, problem, problemText } from './audiobook-problems'

describe('problemText', () => {
  it('says each pick-time problem in the plan’s words', () => {
    const cases: [AudiobookProblem, string][] = [
      [problem('mixed'), 'Pick one M4B file, or the MP3 files of one audiobook.'],
      [
        problem('drm'),
        'This audiobook is copy-protected (DRM), so Folio can’t play it. Folio imports M4B and MP3 files without DRM.',
      ],
      [problem('aax'), 'Audible’s AAX files are copy-protected (DRM), so Folio can’t play them.'],
      [{ code: 'type', type: 'M4A' }, 'Folio imports audiobooks as M4B or MP3 files. This one is M4A.'],
      [{ code: 'type', type: 'FLAC' }, 'Folio imports audiobooks as M4B or MP3 files. This one is FLAC.'],
      [{ code: 'type', type: null }, 'Folio imports audiobooks as M4B or MP3 files. This one is not an audio file.'],
      [problem('large'), 'This audiobook is larger than 2 GB.'],
      [problem('files'), 'An audiobook can have at most 500 MP3 files.'],
      [problem('chapters'), 'This audiobook has more than 1,000 chapters.'],
      [problem('long'), 'One of this audiobook’s chapters is longer than 24 hours.'],
      [problem('room'), 'Your audiobooks would go over 8 GB. Delete one to make room.'],
      [{ code: 'unreadable', reason: 'End-Of-Stream.' }, 'This file couldn’t be read: End-Of-Stream.'],
      [problem('off'), 'Audiobook imports aren’t turned on for this server yet.'],
    ]
    for (const [p, text] of cases) expect(problemText(p)).toBe(text)
  })

  it('says each server answer', () => {
    const cases: [AudiobookProblem, string][] = [
      [problem('server-full'), 'The server is short of space for audiobooks right now. Try again later.'],
      [problem('books'), 'You have 25 of your own books. Delete one to import another.'],
      [problem('rate'), 'You’ve imported 10 books in the last hour. Try again later.'],
      [
        { code: 'server-unreadable', reason: 'it isn’t an M4B file' },
        'Folio couldn’t read this audiobook on the server: it isn’t an M4B file.',
      ],
      [problem('signed-out'), 'You’ve been signed out. Sign in again, then import the audiobook again.'],
      [problem('interrupted'), 'The import was interrupted. Try again.'],
      [
        problem('invalid'),
        'The audiobook couldn’t be saved as it is. Check the title, author and language, then try again.',
      ],
      [problem('stopped'), 'The upload stopped. Check your connection, then press Resume.'],
      [problem('failed'), 'Something went wrong while saving. Try again in a few minutes.'],
    ]
    for (const [p, text] of cases) expect(problemText(p)).toBe(text)
  })

  it('offers Resume only for a stopped upload', () => {
    expect(isResumable(problem('stopped'))).toBe(true)
    expect(isResumable(problem('server-full'))).toBe(false)
  })
})
