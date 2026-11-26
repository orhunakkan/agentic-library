import { privateBookSlug } from '../../shared/content/book-slug.ts'
import { resolveAiModel } from '../../shared/lib/ai-models.ts'
import { resolveSpeechModel } from '../../shared/lib/speech-models.ts'
import { describeDevice } from '../device.ts'

export const USER_TABLES: Record<string, string | null> = {
  email_tokens: null,
  signup_tokens: null,
  sessions: 'sessions',
  api_keys: 'apiKeys',
  passkeys: 'passkeys',
  access_tokens: 'accessTokens',
  github_repos: 'githubRepos',
  passkey_challenges: null,
  audit_events: 'activity',
  user_books: 'privateBooks',
  highlights: 'highlights',
  bookmarks: 'bookmarks',
  flashcards: 'flashcards',
  audio_bookmarks: 'audioBookmarks',
  reading_places: 'readingPlaces',
  listening_places: 'listeningPlaces',
  reader_settings: 'readerSettings',
  shelves: 'shelves',
  shelf_books: 'shelves',
  removed_books: 'removedBooks',
  book_ratings: 'ratings',
  ask_prompts: 'askPrompts',
  speech_usage: 'speechUsage',
  reading_time: 'readingTime',
  finished_books: 'finishedBooks',
  reading_goals: 'readingGoals',
}

export const EXPORT_FORMAT = 'folio-account'
export const EXPORT_VERSION = 1

export interface BookKey {
  slug: string | null
  userBookId: string | null
}

export interface AccountRows {
  account: {
    username: string
    role: string
    createdAt: Date
    passwordChangedAt: Date
    aiModel: string | null
    speechModel: string | null
    email: string | null
    emailVerifiedAt: Date | null
    emailBouncedAt: Date | null
    timeZone: string | null
  }
  sessions: { userAgent: string | null; ip: string | null; createdAt: Date; lastSeenAt: Date; expiresAt: Date }[]
  apiKeys: {
    provider: string
    last4: string
    createdAt: Date
    lastUsedAt: Date | null
    lastValidatedAt: Date | null
  }[]
  passkeys: { name: string; createdAt: Date; lastUsedAt: Date | null; backedUp: boolean; transports: string[] }[]
  accessTokens: {
    name: string
    createdAt: Date
    lastUsedAt: Date | null
    expiresAt: Date
    ip: string | null
    userAgent: string | null
  }[]
  githubRepos: {
    owner: string
    name: string
    ref: string | null
    addedAt: Date
    openedAt: Date | null
    goneAt: Date | null
  }[]
  readerSettings: Record<string, unknown> | null
  privateBooks: {
    id: string
    title: string
    author: string
    language: string
    status: string
    chapters: string[]
    description: string | null
    isbn: string | null
    publisher: string | null
    publishedYear: number | null
    openLibraryWork: string | null
    cover: { source: string; width: number; height: number } | null
    imageCount: number
    articleUrl: string | null
    articleWords: number | null
    audio: {
      narrator: string | null
      lengthMs: number
      bytes: number
      files: number
      chapters: { title: string; durationMs: number }[]
    } | null
    createdAt: Date
    readyAt: Date | null
  }[]
  highlights: (BookKey & {
    chapter: string | null
    page: number
    text: string
    color: string
    note: string | null
    createdAt: Date
    updatedAt: Date
  })[]
  bookmarks: (BookKey & { chapter: string | null; page: number; text: string; createdAt: Date })[]
  flashcards: (BookKey & {
    front: string
    back: string
    chapter: string | null
    page: number
    box: number
    dueAt: Date
    createdAt: Date
  })[]
  audioBookmarks: (BookKey & {
    kind: string
    episode: string | null
    positionMs: number | null
    chapter: string | null
    page: number | null
    text: string | null
    createdAt: Date
  })[]
  readingPlaces: (BookKey & { chapter: string | null; page: number; at: Date; device: string })[]
  listeningPlaces: (BookKey & {
    kind: string
    episode: string | null
    positionMs: number | null
    chapter: string | null
    page: number | null
    at: Date
    device: string
  })[]
  shelves: { id: string; name: string; createdAt: Date; books: (BookKey & { addedAt: Date })[] }[]
  removedBooks: (BookKey & { removedAt: Date })[]
  ratings: (BookKey & { stars: number; ratedAt: Date })[]
  askPrompts: {
    name: string
    appliesTo: string
    instruction: string
    position: number
    createdAt: Date
    updatedAt: Date
  }[]
  speechUsage: { minute: Date; characters: number; requests: number }[]
  readingTime: { day: string; readingSeconds: number; listeningSeconds: number }[]
  finishedBooks: (BookKey & { finishedAt: Date })[]
  readingGoals: { fromDay: string; minutes: number; setAt: Date }[]
  activity: { event: string; at: Date; ip: string | null; detail: unknown }[]
}

export interface ExportBook {
  slug: string
  title: string | null
}

const iso = (d: Date) => d.toISOString()
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null)

const SETTINGS_KEYS = ['theme', 'font', 'leading', 'measure'] as const

export function toAccountExport(
  rows: AccountRows,
  { now, origin, titles }: { now: Date; origin: string; titles: ReadonlyMap<string, string> },
) {
  const privateTitles = new Map(rows.privateBooks.map((b) => [b.id, b.title]))
  const book = (key: BookKey): ExportBook =>
    key.userBookId !== null
      ? { slug: privateBookSlug(key.userBookId), title: privateTitles.get(key.userBookId) ?? null }
      : { slug: key.slug ?? '', title: titles.get(key.slug ?? '') ?? null }
  const settings = rows.readerSettings

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: iso(now),
    site: origin,
    account: {
      username: rows.account.username,
      role: rows.account.role,
      createdAt: iso(rows.account.createdAt),
      passwordChangedAt: iso(rows.account.passwordChangedAt),
      aiModel: resolveAiModel(rows.account.aiModel),
      speechModel: resolveSpeechModel(rows.account.speechModel),
      email: rows.account.email,
      emailVerifiedAt: isoOrNull(rows.account.emailVerifiedAt),
      emailBouncedAt: isoOrNull(rows.account.emailBouncedAt),
      timeZone: rows.account.timeZone,
    },
    sessions: rows.sessions.map((session) => ({
      device: describeDevice(session.userAgent),
      ip: session.ip,
      createdAt: iso(session.createdAt),
      lastSeenAt: iso(session.lastSeenAt),
      expiresAt: iso(session.expiresAt),
    })),
    apiKeys: rows.apiKeys.map((apiKey) => ({
      provider: apiKey.provider,
      last4: apiKey.last4,
      createdAt: iso(apiKey.createdAt),
      lastUsedAt: isoOrNull(apiKey.lastUsedAt),
      lastValidatedAt: isoOrNull(apiKey.lastValidatedAt),
    })),
    passkeys: rows.passkeys.map((passkey) => ({
      name: passkey.name,
      createdAt: iso(passkey.createdAt),
      lastUsedAt: isoOrNull(passkey.lastUsedAt),
      backedUp: passkey.backedUp,
      transports: passkey.transports,
    })),
    accessTokens: rows.accessTokens.map((accessToken) => ({
      name: accessToken.name,
      device: describeDevice(accessToken.userAgent),
      ip: accessToken.ip,
      createdAt: iso(accessToken.createdAt),
      lastUsedAt: isoOrNull(accessToken.lastUsedAt),
      expiresAt: iso(accessToken.expiresAt),
    })),
    githubRepos: rows.githubRepos.map((repo) => ({
      owner: repo.owner,
      name: repo.name,
      ref: repo.ref,
      addedAt: iso(repo.addedAt),
      openedAt: isoOrNull(repo.openedAt),
      goneAt: isoOrNull(repo.goneAt),
    })),
    readerSettings: settings ? Object.fromEntries(SETTINGS_KEYS.map((key) => [key, settings[key] ?? null])) : null,
    privateBooks: rows.privateBooks.map((privateBook) => ({
      slug: privateBookSlug(privateBook.id),
      title: privateBook.title,
      author: privateBook.author,
      language: privateBook.language,
      status: privateBook.status,
      chapters: privateBook.chapters,
      description: privateBook.description,
      isbn: privateBook.isbn,
      publisher: privateBook.publisher,
      publishedYear: privateBook.publishedYear,
      openLibraryWork: privateBook.openLibraryWork,
      cover: privateBook.cover && {
        source: privateBook.cover.source,
        width: privateBook.cover.width,
        height: privateBook.cover.height,
      },
      imageCount: privateBook.imageCount,
      articleUrl: privateBook.articleUrl,
      articleWords: privateBook.articleWords,
      audio: privateBook.audio && {
        narrator: privateBook.audio.narrator,
        lengthMs: privateBook.audio.lengthMs,
        size: privateBook.audio.bytes,
        files: privateBook.audio.files,
        chapters: privateBook.audio.chapters.map((c) => ({ title: c.title, durationMs: c.durationMs })),
      },
      createdAt: iso(privateBook.createdAt),
      readyAt: isoOrNull(privateBook.readyAt),
    })),
    highlights: rows.highlights.map((h) => ({
      book: book(h),
      chapter: h.chapter,
      page: h.page,
      text: h.text,
      color: h.color,
      note: h.note,
      createdAt: iso(h.createdAt),
      updatedAt: iso(h.updatedAt),
    })),
    bookmarks: rows.bookmarks.map((bookmark) => ({
      book: book(bookmark),
      chapter: bookmark.chapter,
      page: bookmark.page,
      text: bookmark.text,
      createdAt: iso(bookmark.createdAt),
    })),
    flashcards: rows.flashcards.map((flashcard) => ({
      book: book(flashcard),
      front: flashcard.front,
      back: flashcard.back,
      chapter: flashcard.chapter,
      page: flashcard.page,
      box: flashcard.box,
      dueAt: iso(flashcard.dueAt),
      createdAt: iso(flashcard.createdAt),
    })),
    audioBookmarks: rows.audioBookmarks.map((audioBookmark) => ({
      book: book(audioBookmark),
      kind: audioBookmark.kind,
      episode: audioBookmark.episode,
      positionMs: audioBookmark.positionMs,
      chapter: audioBookmark.chapter,
      page: audioBookmark.page,
      text: audioBookmark.text,
      createdAt: iso(audioBookmark.createdAt),
    })),
    readingPlaces: rows.readingPlaces.map((readingPlace) => ({
      book: book(readingPlace),
      chapter: readingPlace.chapter,
      page: readingPlace.page,
      at: iso(readingPlace.at),
      device: readingPlace.device,
    })),
    listeningPlaces: rows.listeningPlaces.map((listeningPlace) => ({
      book: book(listeningPlace),
      kind: listeningPlace.kind,
      episode: listeningPlace.episode,
      positionMs: listeningPlace.positionMs,
      chapter: listeningPlace.chapter,
      page: listeningPlace.page,
      at: iso(listeningPlace.at),
      device: listeningPlace.device,
    })),
    shelves: rows.shelves.map((s) => ({
      name: s.name,
      createdAt: iso(s.createdAt),
      books: s.books.map((b) => ({ book: book(b), addedAt: iso(b.addedAt) })),
    })),
    removedBooks: rows.removedBooks.map((r) => ({ book: book(r), removedAt: iso(r.removedAt) })),
    ratings: rows.ratings.map((r) => ({ book: book(r), stars: r.stars, ratedAt: iso(r.ratedAt) })),
    askPrompts: rows.askPrompts.map((askPrompt) => ({
      name: askPrompt.name,
      appliesTo: askPrompt.appliesTo,
      instruction: askPrompt.instruction,
      position: askPrompt.position,
      createdAt: iso(askPrompt.createdAt),
      updatedAt: iso(askPrompt.updatedAt),
    })),
    speechUsage: rows.speechUsage.map((u) => ({
      minute: iso(u.minute),
      characters: u.characters,
      requests: u.requests,
    })),
    readingTime: rows.readingTime.map((t) => ({
      day: t.day,
      readingSeconds: t.readingSeconds,
      listeningSeconds: t.listeningSeconds,
    })),
    finishedBooks: rows.finishedBooks.map((f) => ({ book: book(f), finishedAt: iso(f.finishedAt) })),
    readingGoals: rows.readingGoals.map((g) => ({ fromDay: g.fromDay, minutes: g.minutes, setAt: iso(g.setAt) })),
    activity: [...rows.activity]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .map((e) => ({ event: e.event, at: iso(e.at), ip: e.ip, detail: e.detail })),
  }
}

export function exportFileName(username: string, now: Date): string {
  return `folio-account-${username}-${now.toISOString().slice(0, 10)}.json`
}
