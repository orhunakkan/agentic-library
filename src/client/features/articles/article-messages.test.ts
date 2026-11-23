import { describe, expect, it } from 'vitest'
import {
  type ArticleProblem,
  articleProblemText,
  canRetry,
  cardLine,
  countText,
  progressText,
  savedText,
} from './article-messages'

describe('articleProblemText', () => {
  const sentences: Record<Exclude<ArticleProblem, 'quota' | 'limited'>, string> = {
    empty: 'Paste an article’s address.',
    too_long: 'That address is too long.',
    not_url: 'That isn’t a web address. Paste one like https://example.com/a-long-read.',
    scheme: 'Only http and https addresses can be saved.',
    port: 'Folio only opens addresses on the usual web ports.',
    credentials: 'Remove the name and password from the address, then try again.',
    private_host: 'Folio can’t open addresses on a private network.',
    blocked: 'Folio can’t open addresses on a private network.',
    own_site: 'That’s a Folio address. Open it in Folio instead.',
    page_not_found: 'That site has no page at that address.',
    refused: 'That site didn’t let Folio in. It may need a sign-in, or block apps like Folio.',
    not_html: 'That address isn’t a web page. To read a PDF or EPUB, import it on My books.',
    too_large: 'That page is too large to save (over 5 MB).',
    too_many_redirects: 'That address redirects too many times.',
    no_article: 'Folio couldn’t find an article on that page. It may need a sign-in, or be mostly pictures or video.',
    exists: 'You’ve already saved this article.',
    expired: 'That took too long. Save it again.',
    busy: 'Folio is fetching a lot of pages right now. Try again in a minute.',
    unavailable: 'Couldn’t reach that site. Check the address and try again.',
    signed_out: 'You’re signed out. Sign in again to save articles.',
    failed: 'Something went wrong. Try again.',
  }
  it.each(Object.entries(sentences))('%s', (code, sentence) =>
    expect(articleProblemText(code as ArticleProblem)).toBe(sentence),
  )
  it('says each plan’s limit', () => {
    expect(articleProblemText('quota', { plan: 'free', max: 20 })).toBe(
      'Free includes 20 saved articles. Delete one, or go Pro for up to 500.',
    )
    expect(articleProblemText('quota', { plan: 'free' })).toContain('Free includes 20')
    expect(articleProblemText('quota', { plan: 'pro', max: 500 })).toBe(
      'You have 500 saved articles, the most an account can keep. Delete one to save another.',
    )
    expect(articleProblemText('quota')).toContain('You have 500')
  })
  it('says when to try again', () => {
    expect(articleProblemText('limited', { retryAt: '2026-11-21T14:05:00Z', timeZone: 'UTC' })).toBe(
      'You’ve saved a lot in the last hour. Try again after 14:05.',
    )
    expect(articleProblemText('limited')).toBe('You’ve saved a lot in the last hour. Try again later.')
  })
})

describe('the page’s lines', () => {
  it('offers Retry only where it may work', () => {
    expect(canRetry('unavailable')).toBe(true)
    expect(canRetry('failed')).toBe(true)
    expect(canRetry('blocked')).toBe(false)
  })
  it('counts', () => {
    expect(countText(4, 20)).toBe('4 of 20 articles')
    expect(countText(0, 1)).toBe('0 of 1 article')
  })
  it('steps through the save', () => {
    expect(progressText({ stage: 'fetching' })).toBe('Fetching the page…')
    expect(progressText({ stage: 'reading' })).toBe('Finding the article…')
    expect(progressText({ stage: 'pictures', done: 3, total: 12 })).toBe('Saving pictures… 3 of 12')
    expect(progressText({ stage: 'saving' })).toBe('Saving…')
  })
  it('says what was left out', () => {
    expect(savedText(0, 0)).toBe('Saved.')
    expect(savedText(2, 0)).toBe('Saved, without 2 pictures that couldn’t be fetched.')
    expect(savedText(1, 0)).toBe('Saved, without 1 picture that couldn’t be fetched.')
    expect(savedText(0, 3)).toBe('Saved, without 3 pictures past the 40 an article keeps.')
    expect(savedText(2, 3)).toBe(
      'Saved, without 5 pictures: 2 couldn’t be fetched, and 3 were past the 40 an article keeps.',
    )
  })
  it('describes a card', () => expect(cardLine('example.com', 1840)).toBe('From example.com · 8 min read'))
})
