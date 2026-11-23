import type { ArticleUrlProblem, WebFetchProblem } from '~/shared/articles/contract'
import { readTimeText } from '~/shared/articles/read-time'
import type { Plan } from '~/shared/plans/plans'

export type ArticleProblem =
  | ArticleUrlProblem
  | WebFetchProblem
  | 'signed_out'
  | 'no_article'
  | 'exists'
  | 'quota'
  | 'expired'
  | 'limited'
  | 'busy'
  | 'failed'

export const INTRO =
  'Save a web article to read here, with everything a book has: highlights, Ask, read aloud and offline. Folio fetches the page from its own server, so the site never sees you.'
export const EMPTY_TEXT = 'You haven’t saved an article yet.'
export const NEEDS_JAVASCRIPT = 'Saving articles needs JavaScript.'
export const DELETE_NOTE = 'Deleted articles are removed at once. Nightly backups keep a copy for up to 14 days.'

const SENTENCES: Record<Exclude<ArticleProblem, 'quota' | 'limited'>, string> = {
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

const clockTime = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone })

export interface ProblemContext {
  plan?: Plan
  max?: number
  retryAt?: string | null
  timeZone?: string
}

export function articleProblemText(problem: ArticleProblem, context: ProblemContext = {}): string {
  if (problem === 'quota') {
    if (context.plan === 'free')
      return `Free includes ${context.max ?? 20} saved articles. Delete one, or go Pro for up to 500.`
    return `You have ${context.max ?? 500} saved articles, the most an account can keep. Delete one to save another.`
  }
  if (problem === 'limited') {
    const base = 'You’ve saved a lot in the last hour.'
    return context.retryAt
      ? `${base} Try again after ${clockTime(context.retryAt, context.timeZone)}.`
      : `${base} Try again later.`
  }
  return SENTENCES[problem]
}

export const canRetry = (problem: ArticleProblem) => problem === 'unavailable' || problem === 'failed'

export const countText = (count: number, max: number) => `${count} of ${max} article${max === 1 ? '' : 's'}`

export type SaveStage =
  | { stage: 'fetching' }
  | { stage: 'reading' }
  | { stage: 'pictures'; done: number; total: number }
  | { stage: 'saving' }

export function progressText(progress: SaveStage): string {
  switch (progress.stage) {
    case 'fetching':
      return 'Fetching the page…'
    case 'reading':
      return 'Finding the article…'
    case 'pictures':
      return `Saving pictures… ${progress.done} of ${progress.total}`
    case 'saving':
      return 'Saving…'
  }
}

const pictures = (n: number) => `${n} picture${n === 1 ? '' : 's'}`

export function savedText(failed: number, capped: number): string {
  if (!failed && !capped) return 'Saved.'
  if (!capped) return `Saved, without ${pictures(failed)} that couldn’t be fetched.`
  if (!failed) return `Saved, without ${pictures(capped)} past the 40 an article keeps.`
  return `Saved, without ${pictures(failed + capped)}: ${failed} couldn’t be fetched, and ${capped} were past the 40 an article keeps.`
}

export const cardLine = (site: string, words: number) => `From ${site} · ${readTimeText(words)}`
