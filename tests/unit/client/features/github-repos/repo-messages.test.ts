import { describe, expect, it } from 'vitest'
import {
  agoText,
  canRetry,
  countText,
  downloadedText,
  downloadingLabel,
  externalImagesText,
  linesText,
  noRoomText,
  noticeText,
  REPO_TEXT,
  type RepoProblem,
  refLabel,
  refName,
  refreshedText,
  removeQuestion,
  repoProblemText,
  shortSha,
  sizeText,
  tooLargeText,
} from '~/client/features/github-repos/repo-messages'

describe('repoProblemText', () => {
  it.each<[RepoProblem, string]>([
    ['empty', 'Paste a repository’s address.'],
    ['too_long', 'That address is too long.'],
    ['not_url', 'That isn’t a web address. Paste one like https://github.com/addyosmani/agent-skills.'],
    ['not_github', 'Only github.com repositories can be added.'],
    [
      'not_repository',
      'That’s not a repository’s address. Paste the repository’s own address, like https://github.com/addyosmani/agent-skills.',
    ],
    ['not_found', 'GitHub has no public repository at that address. It may be private, renamed or deleted.'],
    ['ref_not_found', 'That repository has no branch or tag by that name.'],
    ['exists', 'You already have this repository.'],
    ['quota', 'You have 25 repositories, the most an account can keep. Remove one to add another.'],
    ['limited', 'You’ve done that a lot in the last hour. Try again later.'],
    ['busy', 'GitHub is busy or Folio’s share of it is used up. Try again in a minute.'],
    ['unavailable', 'Couldn’t reach GitHub. Try again.'],
    ['failed', 'Something went wrong. Try again.'],
    ['signed_out', 'Your session has ended. Sign in again.'],
  ])('%s', (problem, text) => {
    expect(repoProblemText(problem)).toBe(text)
  })

  it('says when to try again after GitHub’s reset', () => {
    expect(repoProblemText('busy', '2026-11-21T14:05:30Z', 'UTC')).toBe(
      'GitHub is busy or Folio’s share of it is used up. Try again after 14:05.',
    )
  })

  it('has a sentence for every problem', () => {
    for (const text of Object.values(REPO_TEXT)) expect(text).toMatch(/\.$/)
  })

  it('offers Retry only where a second try can help', () => {
    expect(canRetry('unavailable')).toBe(true)
    expect(canRetry('failed')).toBe(true)
    expect(canRetry('not_found')).toBe(false)
    expect(canRetry('busy')).toBe(false)
  })
})

describe('the small lines', () => {
  it('names the ref', () => {
    expect(refLabel({ refKind: 'default' })).toBe('Default branch')
    expect(refLabel({ refKind: 'branch' })).toBe('Branch')
    expect(refLabel({ refKind: 'tag' })).toBe('Tag')
    expect(refLabel({ refKind: 'commit' })).toBe('Commit')
    expect(refName({ ref: null, defaultBranch: 'main' })).toBe('main')
    expect(refName({ ref: 'v1.2.0', defaultBranch: 'main' })).toBe('v1.2.0')
  })

  it('counts, refreshes and asks before removing', () => {
    expect(countText(3)).toBe('3 of 25 repositories')
    expect(shortSha('abc1234def')).toBe('abc1234')
    expect(refreshedText(true, 'def5678aaaa')).toBe('Updated to def5678.')
    expect(refreshedText(false, 'def5678aaaa')).toBe('Already up to date.')
    expect(removeQuestion({ owner: 'o', name: 'r' })).toBe(
      'Remove o/r from your repositories? Nothing changes on GitHub.',
    )
  })

  it('sizes and lines', () => {
    expect(sizeText(1)).toBe('1 byte')
    expect(sizeText(512)).toBe('512 bytes')
    expect(sizeText(88 * 1024)).toBe('88 KB')
    expect(sizeText(2.4 * 1024 * 1024)).toBe('2.4 MB')
    expect(linesText(1)).toBe('1 line')
    expect(linesText(12_412)).toBe('12,412 lines')
  })

  it('the notices', () => {
    expect(noticeText({ notice: 'too-large', size: 2.4 * 1024 * 1024 })).toBe(
      'This file is too large to show here (2.4 MB). Open it on GitHub.',
    )
    expect(noticeText({ notice: 'binary', size: 88 * 1024 })).toBe('This is a binary file (88 KB).')
    expect(noticeText({ notice: 'lfs' })).toBe('This file is stored with Git LFS, which Folio can’t show.')
    expect(noticeText({ notice: 'submodule' })).toBe(
      'This is a submodule: another repository, which Folio doesn’t open.',
    )
    expect(noticeText({ notice: 'link', target: 'x', targetPath: null })).toBe('Link to')
  })

  it('the pictures from other sites', () => {
    expect(externalImagesText(3)).toBe(
      'This file shows 3 pictures from other sites. Showing them lets those sites see your visit.',
    )
    expect(externalImagesText(1)).toBe(
      'This file shows 1 picture from other sites. Showing them lets those sites see your visit.',
    )
  })
})

describe('agoText', () => {
  const now = Date.parse('2026-11-21T12:00:00Z')
  const ago = (ms: number) => agoText(new Date(now - ms).toISOString(), now)

  it('says just now, minutes, hours and days', () => {
    expect(ago(30_000)).toBe('just now')
    expect(ago(-5000)).toBe('just now')
    expect(ago(60_000)).toBe('1 minute ago')
    expect(ago(5 * 60_000)).toBe('5 minutes ago')
    expect(ago(60 * 60_000)).toBe('1 hour ago')
    expect(ago(3 * 60 * 60_000)).toBe('3 hours ago')
    expect(ago(24 * 60 * 60_000)).toBe('1 day ago')
    expect(ago(3 * 24 * 60 * 60_000)).toBe('3 days ago')
  })
})

describe('the download lines', () => {
  const caps = { maxFiles: 2000, maxBytes: 20 * 1024 * 1024 }

  it('say what’s too big, with the numbers, or that GitHub listed only part of it', () => {
    expect(tooLargeText({ files: 2500, bytes: 3 * 1024 * 1024, ...caps })).toBe(
      'This repository is too big to download: 2,500 files, 3 MB of source. Downloads hold up to 2,000 files and 20 MB of source.',
    )
    expect(tooLargeText({ files: 1, bytes: 25 * 1024 * 1024, ...caps })).toContain('1 file, 25 MB of source.')
    expect(tooLargeText({ files: null, bytes: null, ...caps })).toBe(
      'This repository is too big to download: GitHub lists only part of its files. Downloads hold up to 2,000 files and 20 MB of source.',
    )
  })

  it('say how much room a download needs, what it took, and what the progress is of', () => {
    expect(noRoomText(6 * 1024 * 1024)).toBe('There isn’t room on this device for this repository (about 6 MB).')
    expect(downloadedText(1536 * 1024)).toBe('Downloaded · 1.5 MB')
    expect(downloadingLabel({ owner: 'folio-test', name: 'sample' })).toBe('Downloading folio-test/sample')
  })
})
