import { notFound, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import type { ArticlesState } from '~/shared/articles/contract'
import type { PlanState } from '~/shared/billing/billing'
import { chapterPageHref } from '~/shared/content/navigation'
import {
  buildPrivateAudiobookPage,
  buildPrivateBookPage,
  myShelf,
  type PrivateAudiobookPage,
  type PrivateBookPage,
  privateBookHref,
  privateCover,
  privateCoverImage,
  privateSlug,
} from '~/shared/content/private-book'
import type { RepoFolderState, ReposState, RepoViewState } from '~/shared/github-repos/contract'
import { costOf } from '~/shared/lib/speech-models'
import { MAX_PASSKEYS } from '~/shared/passkeys/passkeys'
import type { RatingState } from '~/shared/ratings/ratings'
import type { SpeechVoicesState } from '~/shared/read-aloud/cloud'
import type { ReadingStatsState, ReadingSummaryState } from '~/shared/reading-stats/contract'
import type { SyncState } from '~/shared/sync/sync'
import { isUuid } from '../shared/uuid.ts'
import { listAccessTokens } from './access-tokens/store.ts'
import { toAccessTokenView } from './access-tokens/view.ts'
import { usersForAdmin } from './admin/actions.ts'
import { invitesForAdmin } from './admin/invites.ts'
import { getKeyStatuses, PROVIDERS } from './api-keys.ts'
import { articlesState, myArticlesState } from './articles/actions.ts'
import { type AskSetup, askSetup } from './ask/setup.ts'
import { type AskPromptsState, askPromptsState } from './ask-prompts/actions.ts'
import { audiobooksOn } from './audiobooks/files.ts'
import { audioBytesUsed, loadAudiobook } from './audiobooks/store.ts'
import { loginHref, readSessionToken, sessionForRequest, viewerForRequest } from './auth.ts'
import { planStateFor } from './billing/actions.ts'
import { imageBytesUsed } from './book-images/store.ts'
import { isBookSlug } from './book-ref/ref.ts'
import { type AudioBookmarksState, audioBookmarksState } from './bookmarks/audio-actions.ts'
import { type BookBookmarksState, bookBookmarksState } from './bookmarks/read.ts'
import { getConfig } from './config.ts'
import { getDb, isDatabaseConfigured } from './db.ts'
import { describeDevice } from './device.ts'
import { type ConfirmPage, confirmPage, emailSection, type ResetPage, resetPage } from './email/actions.ts'
import { bookFlashcardsState, flashcardBooksState } from './flashcards/page.ts'
import { repoFolderState, reposState, repoViewState } from './github-repos/actions.ts'
import { parseView } from './github-repos/input.ts'
import { highlightsPageState } from './highlights/page.ts'
import { type BookHighlightsState, bookHighlightsState } from './highlights/read.ts'
import { mailAvailable } from './mail/mail.ts'
import { listPasskeys } from './passkeys/store.ts'
import { toPasskeyView } from './passkeys/view.ts'
import { planUsage } from './plans/plan.ts'
import { getRating } from './ratings/store.ts'
import { statsState, summaryState } from './reading-stats/read.ts'
import { hashToken } from './security.ts'
import { listSessions } from './sessions.ts'
import { type ShelvesState, shelvesState } from './shelves/actions.ts'
import { signedInRead } from './signed-in.ts'
import { type SignupPage, signupPage } from './signup/actions.ts'
import { speechVoicesState } from './speech/actions.ts'
import { usageLast30Days } from './speech/store.ts'
import { type ReadingPlaceState, readingPlaceState, syncState } from './sync/read.ts'
import { countedBooks, listArticles, listBooks, loadBookPage } from './user-books.ts'
import { getAiModel, getSpeechModel } from './users.ts'

export const getViewer = createServerFn({ method: 'GET' }).handler(() => viewerForRequest(getRequest()))

export const getSignInAvailable = createServerFn({ method: 'GET' }).handler(() => ({
  signIn: isDatabaseConfigured(),
  mail: mailAvailable(),
  signup: isDatabaseConfigured() ? getConfig().signup : ('off' as const),
}))

async function requireSession(next: string) {
  const request = getRequest()
  const session = await sessionForRequest(request)
  const token = readSessionToken(request.headers)
  if (!session || !token) throw redirect({ href: loginHref(next) })
  return { session, tokenHash: hashToken(token) }
}

export const getAccountPage = createServerFn({ method: 'GET' }).handler(async () => {
  const { session, tokenHash } = await requireSession('/account')
  const [sessions, email, usage, planState, passkeys, accessTokens] = await Promise.all([
    listSessions(getDb(), session.userId, tokenHash),
    emailSection(session.userId),
    planUsage(getDb(), session.userId),
    planStateFor(session),
    listPasskeys(getDb(), session.userId),
    listAccessTokens(getDb(), session.userId),
  ])
  return {
    username: session.username,
    role: session.role,
    plan: {
      plan: session.plan,
      source: usage?.source ?? (session.plan === 'pro' ? 'given' : 'free'),
      bookCount: usage?.books ?? 0,
      highlightCount: usage?.highlights ?? 0,
      subscription: planState.subscription,
    },
    email: email && {
      confirmed: email.confirmed && {
        email: email.confirmed.email,
        verifiedAt: email.confirmed.verifiedAt.toISOString(),
      },
      bounced: email.bounced,
      pending: email.pending && { email: email.pending.email, bounced: email.pending.bounced },
    },
    passkeys: passkeys.map(toPasskeyView),
    passkeyMax: MAX_PASSKEYS,
    sessions: sessions.map((s) => ({
      current: s.current,
      device: describeDevice(s.userAgent),
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
    })),
    accessTokens: accessTokens.map((t) => toAccessTokenView(t)),
  }
})

export const getPlanPage = createServerFn({ method: 'GET' }).handler(async (): Promise<PlanState> => {
  const { session } = await requireSession('/account/plan')
  return planStateFor(session)
})

export type { ConfirmPage, ResetPage, SignupPage }

const tokenInput = (data: { token?: unknown }) => ({
  token: typeof data?.token === 'string' && data.token.length <= 100 ? data.token : undefined,
})

export const getSignupPage = createServerFn({ method: 'POST' })
  .validator(tokenInput)
  .handler(({ data }): Promise<SignupPage> => signupPage(getRequest(), data.token))

export const getResetPage = createServerFn({ method: 'POST' })
  .validator(tokenInput)
  .handler(({ data }): Promise<ResetPage> => resetPage(data.token))

export const getConfirmPage = createServerFn({ method: 'POST' })
  .validator(tokenInput)
  .handler(({ data }): Promise<ConfirmPage> => confirmPage(getRequest(), data.token))

export const getUsersPage = createServerFn({ method: 'GET' }).handler(async () => {
  const { session } = await requireSession('/account/users')
  const users = await usersForAdmin(session)
  if (!users) throw notFound()
  return { users, invites: await invitesForAdmin(), signup: getConfig().signup }
})

export const getApiKeysPage = createServerFn({ method: 'GET' }).handler(async () => {
  const { session } = await requireSession('/account/api-keys')
  const [saved, model, speechModel, speechCharacters] = await Promise.all([
    getKeyStatuses(getDb(), session.userId),
    getAiModel(getDb(), session.userId),
    getSpeechModel(getDb(), session.userId),
    usageLast30Days(getDb(), session.userId),
  ])
  return {
    model,
    speechModel,
    speechUsage: { characters: speechCharacters, cost: costOf(speechModel, speechCharacters) },
    keys: PROVIDERS.map((provider) => {
      const key = saved.find((k) => k.provider === provider)
      return {
        provider,
        saved: key
          ? {
              last4: key.last4,
              createdAt: key.createdAt.toISOString(),
              lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
            }
          : null,
      }
    }),
  }
})

export const getAskSetup = createServerFn({ method: 'GET' }).handler((): Promise<AskSetup> => askSetup(getRequest()))

export const getMyBooksPage = createServerFn({ method: 'GET' }).handler(async () => {
  const { session } = await requireSession('/account/books')
  const books = await listBooks(getDb(), session.userId)
  return {
    imageBytesUsed: await imageBytesUsed(getDb(), session.userId),
    audiobooks: await audiobooksOn(),
    audioBytesUsed: await audioBytesUsed(getDb(), session.userId),
    plan: session.plan,
    bookCount: await countedBooks(getDb(), session.userId),
    articleIds: (await listArticles(getDb(), session.userId)).map((a) => a.id),
    books: books.map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      chapterCount: b.chapterCount,
      htmlBytes: b.htmlBytes,
      audioMs: b.format === 'audio' ? (b.audioMs ?? 0) : null,
      importedAt: b.readyAt.toISOString(),
      href: privateBookHref(b.id),
      readHref: b.format === 'audio' ? privateBookHref(b.id) : chapterPageHref(privateSlug(b.id), b.firstChapter, 1),
      cover: privateCover(b.title),
      image: privateCoverImage(b.id, b.cover),
    })),
  }
})

export const getPrivateBookPage = createServerFn({ method: 'GET' })
  .validator((data: { id?: unknown }) => {
    if (typeof data?.id !== 'string' || data.id.length > 40) throw notFound()
    return { id: data.id }
  })
  .handler(
    async ({
      data,
    }): Promise<
      | { format: 'text'; page: PrivateBookPage; rating: RatingState }
      | { format: 'audio'; page: PrivateAudiobookPage; rating: RatingState }
    > => {
      const { session } = await requireSession(privateBookHref(data.id))
      if (!isUuid(data.id)) throw notFound()
      const [book, stars] = await Promise.all([
        loadBookPage(getDb(), session.userId, data.id),
        getRating(getDb(), session.userId, { slug: null, userBookId: data.id }),
      ])
      const rating: RatingState = { state: 'ready', stars }
      if (book) return { format: 'text', page: buildPrivateBookPage(book), rating }
      const audiobook = await loadAudiobook(getDb(), session.userId, data.id)
      if (!audiobook) throw notFound()
      return { format: 'audio', page: buildPrivateAudiobookPage(audiobook), rating }
    },
  )

export const getMyShelf = createServerFn({ method: 'GET' }).handler(() =>
  signedInRead(
    getRequest(),
    'my shelf',
    async ({ session, db }) => {
      const books = await listBooks(db, session.userId)
      return books.length ? myShelf(books) : null
    },
    { signedOut: null, unavailable: null },
  ),
)

export type { ShelvesState }

export const getArticles = createServerFn({ method: 'GET' }).handler(
  (): Promise<ArticlesState> => articlesState(getRequest()),
)

export const getMyArticles = createServerFn({ method: 'GET' }).handler(() => myArticlesState(getRequest()))

export const getRepos = createServerFn({ method: 'GET' }).handler((): Promise<ReposState> => reposState(getRequest()))

const repoInput = (data: { id: string; path?: string; view?: string }) => ({
  id: typeof data?.id === 'string' ? data.id : '',
  path: typeof data?.path === 'string' ? data.path : '',
  view: parseView(data?.view),
})

export const getRepoView = createServerFn({ method: 'GET' })
  .validator(repoInput)
  .handler(({ data }): Promise<RepoViewState> => repoViewState(getRequest(), data.id, data.path, data.view))

export const getRepoFolder = createServerFn({ method: 'GET' })
  .validator(repoInput)
  .handler(({ data }): Promise<RepoFolderState> => repoFolderState(getRequest(), data.id, data.path))

export const getShelves = createServerFn({ method: 'GET' }).handler(
  (): Promise<ShelvesState> => shelvesState(getRequest()),
)

export const getAskPrompts = createServerFn({ method: 'GET' }).handler(
  (): Promise<AskPromptsState> => askPromptsState(getRequest()),
)

export type { BookBookmarksState, BookHighlightsState }

const bookInput = (data: { book: string }) => {
  if (!isBookSlug(data?.book)) throw new Error('Invalid book')
  return { book: data.book }
}

export const getBookHighlights = createServerFn({ method: 'GET' })
  .validator(bookInput)
  .handler(({ data }) => bookHighlightsState(getRequest(), data.book))

export const getBookBookmarks = createServerFn({ method: 'GET' })
  .validator(bookInput)
  .handler(({ data }) => bookBookmarksState(getRequest(), data.book))

export type { AudioBookmarksState }

export const getAudioBookmarks = createServerFn({ method: 'GET' })
  .validator(bookInput)
  .handler(({ data }): Promise<AudioBookmarksState> => audioBookmarksState(getRequest(), data.book))

export type { ReadingPlaceState }

export const getSpeechVoices = createServerFn({ method: 'GET' })
  .validator(bookInput)
  .handler(({ data }): Promise<SpeechVoicesState> => speechVoicesState(getRequest(), data.book))

export const getSyncState = createServerFn({ method: 'GET' }).handler((): Promise<SyncState> => syncState(getRequest()))

export const getReadingStats = createServerFn({ method: 'GET' }).handler(
  (): Promise<ReadingStatsState> => statsState(getRequest()),
)

export const getReadingSummary = createServerFn({ method: 'GET' }).handler(
  (): Promise<ReadingSummaryState> => summaryState(getRequest()),
)

export const getReadingPlace = createServerFn({ method: 'GET' })
  .validator(bookInput)
  .handler(({ data }): Promise<ReadingPlaceState> => readingPlaceState(getRequest(), data.book))

export const getHighlightsPage = createServerFn({ method: 'GET' })
  .validator((data: { book?: string }) => {
    if (data?.book !== undefined && !isBookSlug(data.book)) throw notFound()
    return { book: data?.book }
  })
  .handler(async ({ data }) => {
    const state = await highlightsPageState(getRequest(), data.book)
    if (state.kind === 'signed_out') {
      throw redirect({ href: loginHref(data.book ? `/account/highlights?book=${data.book}` : '/account/highlights') })
    }
    if (state.kind === 'not_found') throw notFound()
    return state
  })

export const getFlashcardBooks = createServerFn({ method: 'GET' }).handler(async () => {
  const state = await flashcardBooksState(getRequest())
  if (state.kind === 'signed_out') throw redirect({ href: loginHref('/account/flashcards') })
  return state
})

export const getBookFlashcards = createServerFn({ method: 'GET' })
  .validator((data: { book: string }) => {
    if (!isBookSlug(data?.book)) throw notFound()
    return { book: data.book }
  })
  .handler(async ({ data }) => {
    const state = await bookFlashcardsState(getRequest(), data.book)
    if (state.kind === 'signed_out') throw redirect({ href: loginHref(`/account/flashcards?book=${data.book}`) })
    if (state.kind === 'not_found') throw notFound()
    return state
  })
