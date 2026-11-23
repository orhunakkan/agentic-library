import { describe, expect, it } from 'vitest'
import { type AccountRows, exportFileName, toAccountExport, USER_TABLES } from './export'

const at = (minute: number) => new Date(Date.UTC(2026, 10, 6, 12, minute))
const BOOK_ID = '6f1c0000-0000-4000-8000-000000000001'
const AUDIOBOOK_ID = '6f1c0000-0000-4000-8000-000000000002'

const rows = (): AccountRows => ({
  account: {
    username: 'ada',
    role: 'member',
    createdAt: at(0),
    passwordChangedAt: at(1),
    aiModel: null,
    speechModel: 'eleven_v4',
    email: 'ada@example.com',
    emailVerifiedAt: at(2),
    emailBouncedAt: null,
    timeZone: 'Europe/Istanbul',
  },
  sessions: [
    {
      userAgent: 'Mozilla/5.0 (iPhone) Safari/605.1',
      ip: '203.0.113.5',
      createdAt: at(2),
      lastSeenAt: at(3),
      expiresAt: at(4),
    },
  ],
  apiKeys: [{ provider: 'anthropic', last4: 'ab12', createdAt: at(5), lastUsedAt: null, lastValidatedAt: at(6) }],
  passkeys: [{ name: 'Chrome on macOS', createdAt: at(7), lastUsedAt: null, backedUp: true, transports: ['internal'] }],
  accessTokens: [
    {
      name: 'API tests',
      createdAt: at(7),
      lastUsedAt: null,
      expiresAt: at(8),
      ip: '203.0.113.6',
      userAgent: 'Mozilla/5.0 (iPhone) Safari/605.1',
    },
  ],
  githubRepos: [
    { owner: 'addyosmani', name: 'agent-skills', ref: null, addedAt: at(7), openedAt: at(8), goneAt: null },
  ],
  readerSettings: { theme: 'dark', font: 'literata', leading: 'normal', measure: 'normal', extra: 'dropped' },
  privateBooks: [
    {
      id: BOOK_ID,
      title: 'My notes',
      author: 'Ada',
      language: 'en',
      status: 'ready',
      chapters: ['One', 'Two'],
      description: null,
      isbn: null,
      publisher: null,
      publishedYear: null,
      openLibraryWork: null,
      cover: { source: 'epub', width: 600, height: 900 },
      imageCount: 2,
      articleUrl: 'https://news.example/a-long-read',
      articleWords: 1840,
      audio: null,
      createdAt: at(7),
      readyAt: at(8),
    },
    {
      id: AUDIOBOOK_ID,
      title: 'Heard',
      author: 'Ada',
      language: 'en',
      status: 'ready',
      chapters: [],
      description: null,
      isbn: null,
      publisher: null,
      publishedYear: null,
      openLibraryWork: null,
      cover: null,
      imageCount: 0,
      articleUrl: null,
      articleWords: null,
      audio: {
        narrator: 'Rex',
        lengthMs: 9000,
        bytes: 36000,
        files: 1,
        chapters: [{ title: 'Opening', durationMs: 9000, extra: 'dropped' } as { title: string; durationMs: number }],
      },
      createdAt: at(7),
      readyAt: at(8),
    },
  ],
  highlights: [
    {
      slug: 'pride-and-prejudice',
      userBookId: null,
      chapter: 'chapter-1',
      page: 1,
      text: 'It is a truth',
      color: 'yellow',
      note: 'A note',
      createdAt: at(9),
      updatedAt: at(10),
    },
    {
      slug: 'gone-from-the-library',
      userBookId: null,
      chapter: null,
      page: 4,
      text: 'Old text',
      color: 'blue',
      note: null,
      createdAt: at(11),
      updatedAt: at(11),
    },
  ],
  bookmarks: [{ slug: null, userBookId: BOOK_ID, chapter: 'one', page: 2, text: 'Opening words', createdAt: at(12) }],
  flashcards: [
    {
      slug: 'pride-and-prejudice',
      userBookId: null,
      front: 'Who is Mr. Darcy?',
      back: 'A proud gentleman.',
      chapter: 'chapter-3',
      page: 2,
      box: 2,
      dueAt: at(20),
      createdAt: at(12),
    },
  ],
  audioBookmarks: [
    {
      slug: 'fixture-audio-book',
      userBookId: null,
      kind: 'episode',
      episode: 'episode-1',
      positionMs: 61000,
      chapter: null,
      page: null,
      text: null,
      createdAt: at(13),
    },
  ],
  readingPlaces: [
    {
      slug: 'pride-and-prejudice',
      userBookId: null,
      chapter: 'chapter-1',
      page: 3,
      at: at(14),
      device: 'Safari on Mac',
    },
  ],
  listeningPlaces: [
    {
      slug: null,
      userBookId: BOOK_ID,
      kind: 'voice',
      episode: null,
      positionMs: null,
      chapter: 'one',
      page: 1,
      at: at(15),
      device: 'Safari on Mac',
    },
  ],
  shelves: [
    {
      id: 'shelf-1',
      name: 'To read',
      createdAt: at(16),
      books: [{ slug: 'pride-and-prejudice', userBookId: null, addedAt: at(17) }],
    },
  ],
  removedBooks: [{ slug: 'pride-and-prejudice', userBookId: null, removedAt: at(22) }],
  ratings: [
    { slug: null, userBookId: BOOK_ID, stars: 2, ratedAt: at(26) },
    { slug: 'gone-from-the-library', userBookId: null, stars: 5, ratedAt: at(27) },
  ],
  askPrompts: [
    {
      name: 'Who is who',
      appliesTo: 'pages',
      instruction: 'List the people so far.\nOne line each.',
      position: 0,
      createdAt: at(28),
      updatedAt: at(29),
    },
  ],
  speechUsage: [{ minute: at(21), characters: 1234, requests: 12 }],
  subscriptions: [
    {
      status: 'active',
      cadence: 'year',
      founding: true,
      periodEndsAt: at(30),
      cancelAt: null,
      canceledAt: null,
      createdAt: at(23),
    },
  ],
  readingTime: [
    { day: '2026-11-06', readingSeconds: 1800, listeningSeconds: 600 },
    { day: '2026-11-05', readingSeconds: 60, listeningSeconds: 0 },
  ],
  finishedBooks: [{ slug: 'pride-and-prejudice', userBookId: null, finishedAt: at(24) }],
  readingGoals: [{ fromDay: '2026-11-01', minutes: 30, setAt: at(25) }],
  activity: [
    { event: 'login.succeeded', at: at(18), ip: '203.0.113.5', detail: {} },
    { event: 'logout', at: at(20), ip: null, detail: {} },
    { event: 'api_key.saved', at: at(19), ip: null, detail: { provider: 'anthropic' } },
  ],
})

const options = {
  now: at(30),
  origin: 'https://agenticlibrary.app',
  titles: new Map([
    ['pride-and-prejudice', 'Pride and Prejudice'],
    ['fixture-audio-book', 'The Audio Book'],
  ]),
}

const keysOf = (value: unknown) => Object.keys(value as object)

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys)
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, inner]) => [key, ...allKeys(inner)])
  return []
}

describe('toAccountExport', () => {
  const out = toAccountExport(rows(), options)

  it('has exactly these keys at every level', () => {
    expect(keysOf(out)).toEqual([
      'format',
      'version',
      'exportedAt',
      'site',
      'account',
      'sessions',
      'apiKeys',
      'passkeys',
      'accessTokens',
      'githubRepos',
      'readerSettings',
      'privateBooks',
      'highlights',
      'bookmarks',
      'flashcards',
      'audioBookmarks',
      'readingPlaces',
      'listeningPlaces',
      'shelves',
      'removedBooks',
      'ratings',
      'askPrompts',
      'speechUsage',
      'subscriptions',
      'readingTime',
      'finishedBooks',
      'readingGoals',
      'activity',
    ])
    expect(keysOf(out.account)).toEqual([
      'username',
      'role',
      'createdAt',
      'passwordChangedAt',
      'aiModel',
      'speechModel',
      'email',
      'emailVerifiedAt',
      'emailBouncedAt',
      'timeZone',
    ])
    expect(keysOf(out.sessions[0])).toEqual(['device', 'ip', 'createdAt', 'lastSeenAt', 'expiresAt'])
    expect(keysOf(out.apiKeys[0])).toEqual(['provider', 'last4', 'createdAt', 'lastUsedAt', 'lastValidatedAt'])
    expect(keysOf(out.passkeys[0])).toEqual(['name', 'createdAt', 'lastUsedAt', 'backedUp', 'transports'])
    expect(out.passkeys[0]).toEqual({
      name: 'Chrome on macOS',
      createdAt: at(7).toISOString(),
      lastUsedAt: null,
      backedUp: true,
      transports: ['internal'],
    })
    expect(keysOf(out.accessTokens[0])).toEqual(['name', 'device', 'ip', 'createdAt', 'lastUsedAt', 'expiresAt'])
    expect(out.accessTokens[0]).toEqual({
      name: 'API tests',
      device: 'Safari on iPhone',
      ip: '203.0.113.6',
      createdAt: at(7).toISOString(),
      lastUsedAt: null,
      expiresAt: at(8).toISOString(),
    })
    expect(out.githubRepos).toEqual([
      {
        owner: 'addyosmani',
        name: 'agent-skills',
        ref: null,
        addedAt: at(7).toISOString(),
        openedAt: at(8).toISOString(),
        goneAt: null,
      },
    ])
    expect(keysOf(out.readerSettings)).toEqual(['theme', 'font', 'leading', 'measure'])
    expect(keysOf(out.privateBooks[0])).toEqual([
      'slug',
      'title',
      'author',
      'language',
      'status',
      'chapters',
      'description',
      'isbn',
      'publisher',
      'publishedYear',
      'openLibraryWork',
      'cover',
      'imageCount',
      'articleUrl',
      'articleWords',
      'audio',
      'createdAt',
      'readyAt',
    ])
    expect(keysOf(out.privateBooks[0]?.cover)).toEqual(['source', 'width', 'height'])
    expect(out.privateBooks[0]?.audio).toBeNull()
    expect(out.privateBooks[0]).toMatchObject({ articleUrl: 'https://news.example/a-long-read', articleWords: 1840 })
    expect(out.privateBooks[1]).toMatchObject({ articleUrl: null, articleWords: null })
    expect(out.privateBooks[1]?.audio).toEqual({
      narrator: 'Rex',
      lengthMs: 9000,
      size: 36000,
      files: 1,
      chapters: [{ title: 'Opening', durationMs: 9000 }],
    })
    expect(keysOf(out.highlights[0])).toEqual([
      'book',
      'chapter',
      'page',
      'text',
      'color',
      'note',
      'createdAt',
      'updatedAt',
    ])
    expect(keysOf(out.bookmarks[0])).toEqual(['book', 'chapter', 'page', 'text', 'createdAt'])
    expect(out.flashcards[0]).toEqual({
      book: { slug: 'pride-and-prejudice', title: 'Pride and Prejudice' },
      front: 'Who is Mr. Darcy?',
      back: 'A proud gentleman.',
      chapter: 'chapter-3',
      page: 2,
      box: 2,
      dueAt: at(20).toISOString(),
      createdAt: at(12).toISOString(),
    })
    expect(keysOf(out.audioBookmarks[0])).toEqual([
      'book',
      'kind',
      'episode',
      'positionMs',
      'chapter',
      'page',
      'text',
      'createdAt',
    ])
    expect(keysOf(out.readingPlaces[0])).toEqual(['book', 'chapter', 'page', 'at', 'device'])
    expect(keysOf(out.listeningPlaces[0])).toEqual([
      'book',
      'kind',
      'episode',
      'positionMs',
      'chapter',
      'page',
      'at',
      'device',
    ])
    expect(keysOf(out.shelves[0])).toEqual(['name', 'createdAt', 'books'])
    expect(keysOf(out.shelves[0]?.books[0])).toEqual(['book', 'addedAt'])
    expect(keysOf(out.removedBooks[0])).toEqual(['book', 'removedAt'])
    expect(keysOf(out.ratings[0])).toEqual(['book', 'stars', 'ratedAt'])
    expect(out.askPrompts).toEqual([
      {
        name: 'Who is who',
        appliesTo: 'pages',
        instruction: 'List the people so far.\nOne line each.',
        position: 0,
        createdAt: at(28).toISOString(),
        updatedAt: at(29).toISOString(),
      },
    ])
    expect(keysOf(out.speechUsage[0])).toEqual(['minute', 'characters', 'requests'])
    expect(out.subscriptions).toEqual([
      {
        status: 'active',
        cadence: 'year',
        founding: true,
        periodEndsAt: '2026-11-06T12:30:00.000Z',
        cancelAt: null,
        canceledAt: null,
        createdAt: '2026-11-06T12:23:00.000Z',
      },
    ])
    expect(out.readingTime).toEqual([
      { day: '2026-11-06', readingSeconds: 1800, listeningSeconds: 600 },
      { day: '2026-11-05', readingSeconds: 60, listeningSeconds: 0 },
    ])
    expect(out.finishedBooks).toEqual([
      { book: { slug: 'pride-and-prejudice', title: 'Pride and Prejudice' }, finishedAt: at(24).toISOString() },
    ])
    expect(out.readingGoals).toEqual([{ fromDay: '2026-11-01', minutes: 30, setAt: at(25).toISOString() }])
    expect(out.account.timeZone).toBe('Europe/Istanbul')
    expect(keysOf(out.activity[0])).toEqual(['event', 'at', 'ip', 'detail'])
  })

  it('has no secret or internal anywhere', () => {
    const forbidden = /hash|ciphertext|^iv$|auth_?tag|offset|prefix|suffix|^pages$|bytes|token|password$/i
    expect(allKeys(out).filter((key) => key !== 'accessTokens' && forbidden.test(key))).toEqual([])
  })

  it('carries every table that references users in a section', () => {
    for (const section of new Set(Object.values(USER_TABLES))) if (section) expect(keysOf(out)).toContain(section)
  })

  it('names every book by slug and title', () => {
    expect(out.highlights.map((h) => h.book)).toEqual([
      { slug: 'pride-and-prejudice', title: 'Pride and Prejudice' },
      { slug: 'gone-from-the-library', title: null },
    ])
    expect(out.bookmarks[0]?.book).toEqual({ slug: `u-${BOOK_ID}`, title: 'My notes' })
    expect(out.listeningPlaces[0]?.book).toEqual({ slug: `u-${BOOK_ID}`, title: 'My notes' })
    expect(out.audioBookmarks[0]?.book).toEqual({ slug: 'fixture-audio-book', title: 'The Audio Book' })
    expect(out.shelves[0]?.books[0]?.book).toEqual({ slug: 'pride-and-prejudice', title: 'Pride and Prejudice' })
    expect(out.removedBooks[0]).toEqual({
      book: { slug: 'pride-and-prejudice', title: 'Pride and Prejudice' },
      removedAt: at(22).toISOString(),
    })
    expect(out.ratings).toEqual([
      { book: { slug: `u-${BOOK_ID}`, title: 'My notes' }, stars: 2, ratedAt: at(26).toISOString() },
      { book: { slug: 'gone-from-the-library', title: null }, stars: 5, ratedAt: at(27).toISOString() },
    ])
    expect(out.privateBooks[0]).toMatchObject({ slug: `u-${BOOK_ID}`, title: 'My notes' })
    const everyBook = [
      ...out.highlights,
      ...out.bookmarks,
      ...out.audioBookmarks,
      ...out.readingPlaces,
      ...out.listeningPlaces,
      ...out.shelves.flatMap((s) => s.books),
      ...out.removedBooks,
      ...out.ratings,
      ...out.finishedBooks,
    ].map((row) => keysOf(row.book))
    expect(everyBook.every((keys) => keys.join() === 'slug,title')).toBe(true)
  })

  it('a private book no longer in the rows gets a null title', () => {
    const lost = toAccountExport({ ...rows(), privateBooks: [] }, options)
    expect(lost.bookmarks[0]?.book).toEqual({ slug: `u-${BOOK_ID}`, title: null })
  })

  it('stamps the format, the version, the site and the time, and resolves the model', () => {
    expect(out).toMatchObject({
      format: 'folio-account',
      version: 1,
      exportedAt: '2026-11-06T12:30:00.000Z',
      site: 'https://agenticlibrary.app',
    })
    expect(out.account.aiModel).toBe('claude-opus-5-5')
    expect(out.account.speechModel).toBe('eleven_v4')
    expect(
      toAccountExport({ ...rows(), account: { ...rows().account, speechModel: null } }, options).account.speechModel,
    ).toBe('eleven_v4_turbo')
    expect(out.speechUsage).toEqual([{ minute: '2026-11-06T12:21:00.000Z', characters: 1234, requests: 12 }])
    expect(out.sessions[0]?.device).toBe('Safari on iPhone')
    expect(out.apiKeys[0]).toMatchObject({ lastUsedAt: null, lastValidatedAt: '2026-11-06T12:06:00.000Z' })
  })

  it('lists activity newest first', () => {
    expect(out.activity.map((e) => e.event)).toEqual(['logout', 'api_key.saved', 'login.succeeded'])
  })

  it('keeps the settings’ four values only, and null when none were synced', () => {
    expect(out.readerSettings).toEqual({ theme: 'dark', font: 'literata', leading: 'normal', measure: 'normal' })
    expect(toAccountExport({ ...rows(), readerSettings: null }, options).readerSettings).toBeNull()
  })

  it('handles an account with nothing in it', () => {
    const empty = toAccountExport(
      {
        ...rows(),
        sessions: [],
        apiKeys: [],
        passkeys: [],
        accessTokens: [],
        githubRepos: [],
        readerSettings: null,
        privateBooks: [],
        highlights: [],
        bookmarks: [],
        flashcards: [],
        audioBookmarks: [],
        readingPlaces: [],
        listeningPlaces: [],
        shelves: [],
        removedBooks: [],
        ratings: [],
        askPrompts: [],
        speechUsage: [],
        readingTime: [],
        finishedBooks: [],
        readingGoals: [],
        activity: [],
      },
      options,
    )
    expect(empty.highlights).toEqual([])
    expect(empty.account.username).toBe('ada')
  })
})

describe('exportFileName', () => {
  it('is the username and the UTC date', () => {
    expect(exportFileName('ada', new Date('2026-11-06T23:59:00-05:00'))).toBe('folio-account-ada-2026-11-07.json')
  })
})
