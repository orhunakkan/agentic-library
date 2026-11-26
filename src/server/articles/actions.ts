import '@tanstack/react-start/server-only'
import { canonicalArticleUrl, parseArticleUrl } from '../../shared/articles/article-url.ts'
import {
  type ArticleErrorCode,
  type ArticlesState,
  type ArticleView,
  siteOf,
  type WebFetchProblem,
} from '../../shared/articles/contract.ts'
import { privateBookSlug } from '../../shared/content/book-slug.ts'
import type { Shelf } from '../../shared/content/library.ts'
import { chapterPageHref } from '../../shared/content/navigation.ts'
import { myArticles } from '../../shared/content/private-book.ts'
import { sniffImage } from '../../shared/import/image.ts'
import { isObject } from '../../shared/lib/json-shape.ts'
import { isUuid } from '../../shared/uuid.ts'
import { recordEvent } from '../audit.ts'
import { noStoreJson, requestIp, seeOther } from '../auth.ts'
import { COVER_HEADERS } from '../book-details/actions.ts'
import { imageBytesUsed } from '../book-images/store.ts'
import { getConfig } from '../config.ts'
import { folioUserAgent } from '../outbound.ts'
import { signedInEndpoints, signedInForm, signedInRead } from '../signed-in.ts'
import { deleteArticle, findArticle, listArticles, type UserArticle } from '../user-books.ts'
import { enter, takeFetch } from './pacing.ts'
import { decodePage, pictureAddresses } from './page.ts'
import { hold, pictureAllowed } from './pending.ts'
import { fetchPage, fetchPicture, type WebFetchOptions } from './web-fetch.ts'

const BODY_BYTES = 4 * 1024

const articles = signedInEndpoints<ArticleErrorCode>({ maxBytes: BODY_BYTES })
const { fail } = articles

const PROBLEM_STATUSES: Record<WebFetchProblem, number> = {
  blocked: 422,
  page_not_found: 404,
  refused: 422,
  not_html: 422,
  too_large: 413,
  too_many_redirects: 422,
  unavailable: 502,
}

function fetchOptions(extra: WebFetchOptions): WebFetchOptions {
  const config = getConfig()
  return {
    ownHosts: [new URL(config.appOrigin).hostname],
    testHosts: config.articleTestHosts,
    userAgent: folioUserAgent(),
    ...extra,
  }
}

function stringFields<K extends string>(value: unknown, keys: readonly K[]): Record<K, string> | null {
  if (!isObject(value) || Object.keys(value).length !== keys.length) return null
  for (const key of keys) if (typeof value[key] !== 'string') return null
  return value as Record<K, string>
}

const limited = (retryAt: Date) => fail(429, 'limited', { retryAt: retryAt.toISOString() })

export function handleArticleFetch(request: Request, extra: WebFetchOptions = {}): Promise<Response> {
  const options = fetchOptions(extra)
  const parseAddress = (value: unknown) => {
    const input = stringFields(value, ['url'])
    if (!input) return null
    const address = parseArticleUrl(input.url, options)
    return address.ok ? address : fail(400, 'invalid', { reason: address.reason })
  }
  return articles.post(request, { log: 'article fetch', parse: parseAddress }, async ({ session, db, input }) => {
    const { userId } = session
    const retryAt = takeFetch('page', userId)
    if (retryAt) return limited(retryAt)
    const saved = await findArticle(db, userId, canonicalArticleUrl(input.url))
    if (saved) return fail(409, 'exists', { id: saved })
    const release = enter('page')
    if (!release) return fail(503, 'busy')
    const page = await fetchPage(input.url.href, options).finally(release)
    if (!page.ok) return fail(PROBLEM_STATUSES[page.problem], page.problem)
    const canonical = canonicalArticleUrl(page.finalUrl)
    const again = await findArticle(db, userId, canonical)
    if (again) return fail(409, 'exists', { id: again })
    const html = decodePage(page.body, page.contentType)
    const id = hold(userId, canonical, pictureAddresses(html, page.finalUrl))
    return noStoreJson(200, { fetch: id, finalUrl: page.finalUrl, html })
  })
}

const pictureNotFound = () => fail(404, 'not_found')

export const handleArticlePicture = (request: Request, extra: WebFetchOptions = {}) =>
  articles.post(
    request,
    { log: 'article picture', parse: (value) => stringFields(value, ['fetch', 'url']) },
    async ({ session, input }) => {
      const { userId } = session
      if (!pictureAllowed(userId, input.fetch, input.url)) return pictureNotFound()
      const retryAt = takeFetch('picture', userId)
      if (retryAt) return limited(retryAt)
      const release = enter('picture')
      if (!release) return fail(503, 'busy')
      const picture = await fetchPicture(input.url, fetchOptions(extra)).finally(release)
      if (!picture.ok) return fail(PROBLEM_STATUSES[picture.problem], picture.problem)
      const info = sniffImage(picture.body)
      if (!info) return pictureNotFound()
      return new Response(new Uint8Array(picture.body), {
        headers: { 'content-type': info.type, 'content-length': String(picture.body.length), ...COVER_HEADERS },
      })
    },
  )

export const handleArticlesForm = (request: Request) =>
  signedInForm(request, { log: 'article delete', next: '/account/articles' }, async ({ session, db, form }) => {
    const id = form.get('id')
    if (form.get('intent') !== 'delete' || typeof id !== 'string' || !isUuid(id))
      return seeOther('/account/articles?error=invalid')
    if (!(await deleteArticle(db, session.userId, id))) return seeOther('/account/articles?error=missing')
    await recordEvent(db, 'book.deleted', { userId: session.userId, ip: requestIp(request), detail: { bookId: id } })
    return seeOther('/account/articles?status=deleted')
  })

function toArticleView(article: UserArticle): ArticleView {
  return {
    id: article.id,
    title: article.title,
    site: siteOf(article.url),
    url: article.url,
    words: article.words,
    savedAt: article.savedAt.toISOString(),
    readHref: chapterPageHref(privateBookSlug(article.id), article.firstChapter, 1),
  }
}

export function articlesState(request: Request): Promise<ArticlesState> {
  return signedInRead(request, 'articles', async ({ session, db }): Promise<ArticlesState> => {
    const [articles, used] = await Promise.all([listArticles(db, session.userId), imageBytesUsed(db, session.userId)])
    const { limits, articleTestHosts } = getConfig()
    return {
      state: 'ready',
      articles: articles.map(toArticleView),
      max: limits.articles,
      limits,
      testHosts: articleTestHosts,
      imageBytesUsed: used,
    }
  })
}

export const myArticlesState = (request: Request): Promise<Shelf | null> =>
  signedInRead(
    request,
    'my articles',
    async ({ session, db }) => {
      const articles = await listArticles(db, session.userId)
      return articles.length ? myArticles(articles) : null
    },
    { signedOut: null, unavailable: null },
  )
