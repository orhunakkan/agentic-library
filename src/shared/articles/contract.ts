export const FREE_ARTICLES = 20
export const PRO_ARTICLES = 500

export const MAX_ARTICLE_URL_LENGTH = 2000
export const MAX_PAGE_BYTES = 5 * 1024 * 1024
export const MAX_PICTURE_BYTES = 10 * 1024 * 1024
export const MAX_PAGE_PICTURES = 500
export const MAX_ARTICLE_PICTURES = 40
export const MIN_ARTICLE_CHARACTERS = 500
export const PICTURE_MAX_CHOSEN_WIDTH = 1600

export type ArticleUrlProblem =
  | 'empty'
  | 'too_long'
  | 'not_url'
  | 'scheme'
  | 'port'
  | 'credentials'
  | 'private_host'
  | 'own_site'

export type WebFetchProblem =
  | 'blocked'
  | 'page_not_found'
  | 'refused'
  | 'not_html'
  | 'too_large'
  | 'too_many_redirects'
  | 'unavailable'

export type ArticleErrorCode =
  | 'signed_out'
  | 'invalid'
  | 'not_found'
  | 'exists'
  | 'expired'
  | 'quota'
  | 'limited'
  | 'busy'
  | 'failed'
  | WebFetchProblem

export interface ArticleFetch {
  fetch: string
  finalUrl: string
  html: string
}

export interface ArticleView {
  id: string
  title: string
  site: string
  url: string
  words: number
  savedAt: string
  readHref: string
}

export type ArticlesState =
  | { state: 'signed_out' }
  | { state: 'unavailable' }
  | {
      state: 'ready'
      articles: ArticleView[]
      max: number
      plan: 'free' | 'pro'
      testHosts: string[]
      imageBytesUsed: number
    }

export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
