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
  subscriptions: 'subscriptions',
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
  subscriptions: {
    status: string
    cadence: string
    founding: boolean
    periodEndsAt: Date | null
    cancelAt: Date | null
    canceledAt: Date | null
    createdAt: Date
  }[]
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
    sessions: rows.sessions.map((s) => ({
      device: describeDevice(s.userAgent),
      ip: s.ip,
      createdAt: iso(s.createdAt),
      lastSeenAt: iso(s.lastSeenAt),
      expiresAt: iso(s.expiresAt),
    })),
    apiKeys: rows.apiKeys.map((k) => ({
      provider: k.provider,
      last4: k.last4,
      createdAt: iso(k.createdAt),
      lastUsedAt: isoOrNull(k.lastUsedAt),
      lastValidatedAt: isoOrNull(k.lastValidatedAt),
    })),
    passkeys: rows.passkeys.map((p) => ({
      name: p.name,
      createdAt: iso(p.createdAt),
      lastUsedAt: isoOrNull(p.lastUsedAt),
      backedUp: p.backedUp,
      transports: p.transports,
    })),
    accessTokens: rows.accessTokens.map((t) => ({
      name: t.name,
      device: describeDevice(t.userAgent),
      ip: t.ip,
      createdAt: iso(t.createdAt),
      lastUsedAt: isoOrNull(t.lastUsedAt),
      expiresAt: iso(t.expiresAt),
    })),
    githubRepos: rows.githubRepos.map((r) => ({
      owner: r.owner,
      name: r.name,
      ref: r.ref,
      addedAt: iso(r.addedAt),
      openedAt: isoOrNull(r.openedAt),
      goneAt: isoOrNull(r.goneAt),
    })),
    readerSettings: settings ? Object.fromEntries(SETTINGS_KEYS.map((key) => [key, settings[key] ?? null])) : null,
    privateBooks: rows.privateBooks.map((b) => ({
      slug: privateBookSlug(b.id),
      title: b.title,
      author: b.author,
      language: b.language,
      status: b.status,
      chapters: b.chapters,
      description: b.description,
      isbn: b.isbn,
      publisher: b.publisher,
      publishedYear: b.publishedYear,
      openLibraryWork: b.openLibraryWork,
      cover: b.cover && { source: b.cover.source, width: b.cover.width, height: b.cover.height },
      imageCount: b.imageCount,
      articleUrl: b.articleUrl,
      articleWords: b.articleWords,
      audio: b.audio && {
        narrator: b.audio.narrator,
        lengthMs: b.audio.lengthMs,
        size: b.audio.bytes,
        files: b.audio.files,
        chapters: b.audio.chapters.map((c) => ({ title: c.title, durationMs: c.durationMs })),
      },
      createdAt: iso(b.createdAt),
      readyAt: isoOrNull(b.readyAt),
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
    bookmarks: rows.bookmarks.map((b) => ({
      book: book(b),
      chapter: b.chapter,
      page: b.page,
      text: b.text,
      createdAt: iso(b.createdAt),
    })),
    flashcards: rows.flashcards.map((f) => ({
      book: book(f),
      front: f.front,
      back: f.back,
      chapter: f.chapter,
      page: f.page,
      box: f.box,
      dueAt: iso(f.dueAt),
      createdAt: iso(f.createdAt),
    })),
    audioBookmarks: rows.audioBookmarks.map((b) => ({
      book: book(b),
      kind: b.kind,
      episode: b.episode,
      positionMs: b.positionMs,
      chapter: b.chapter,
      page: b.page,
      text: b.text,
      createdAt: iso(b.createdAt),
    })),
    readingPlaces: rows.readingPlaces.map((p) => ({
      book: book(p),
      chapter: p.chapter,
      page: p.page,
      at: iso(p.at),
      device: p.device,
    })),
    listeningPlaces: rows.listeningPlaces.map((p) => ({
      book: book(p),
      kind: p.kind,
      episode: p.episode,
      positionMs: p.positionMs,
      chapter: p.chapter,
      page: p.page,
      at: iso(p.at),
      device: p.device,
    })),
    shelves: rows.shelves.map((s) => ({
      name: s.name,
      createdAt: iso(s.createdAt),
      books: s.books.map((b) => ({ book: book(b), addedAt: iso(b.addedAt) })),
    })),
    removedBooks: rows.removedBooks.map((r) => ({ book: book(r), removedAt: iso(r.removedAt) })),
    ratings: rows.ratings.map((r) => ({ book: book(r), stars: r.stars, ratedAt: iso(r.ratedAt) })),
    askPrompts: rows.askPrompts.map((p) => ({
      name: p.name,
      appliesTo: p.appliesTo,
      instruction: p.instruction,
      position: p.position,
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
    })),
    speechUsage: rows.speechUsage.map((u) => ({
      minute: iso(u.minute),
      characters: u.characters,
      requests: u.requests,
    })),
    subscriptions: rows.subscriptions.map((sub) => ({
      status: sub.status,
      cadence: sub.cadence,
      founding: sub.founding,
      periodEndsAt: isoOrNull(sub.periodEndsAt),
      cancelAt: isoOrNull(sub.cancelAt),
      canceledAt: isoOrNull(sub.canceledAt),
      createdAt: iso(sub.createdAt),
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
