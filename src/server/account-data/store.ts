import '@tanstack/react-start/server-only'
import type { Db } from '../db.ts'
import { SESSION_IDLE } from '../sessions.ts'
import type { AccountRows } from './export.ts'

export async function readAccount(db: Db, userId: number): Promise<AccountRows | null> {
  const [account] = await db<
    {
      username: string
      role: string
      created_at: Date
      password_changed_at: Date
      ai_model: string | null
      speech_model: string | null
      email: string | null
      email_verified_at: Date | null
      email_bounced_at: Date | null
      time_zone: string | null
    }[]
  >`
    select username, role, created_at, password_changed_at, ai_model, speech_model, email, email_verified_at, email_bounced_at,
      time_zone
    from users where id = ${userId}`
  if (!account) return null

  const [
    sessions,
    apiKeys,
    passkeys,
    accessTokens,
    githubRepos,
    settings,
    books,
    chapters,
    audioChapters,
    highlights,
    bookmarks,
    flashcards,
    audioBookmarks,
    readingPlaces,
    listeningPlaces,
    shelves,
    shelfBooks,
    removedBooks,
    ratings,
    askPrompts,
    speechUsage,
    subscriptions,
    readingTime,
    finishedBooks,
    readingGoals,
    activity,
  ] = await Promise.all([
    db<{ user_agent: string | null; ip: string | null; created_at: Date; last_seen_at: Date; expires_at: Date }[]>`
      select user_agent, host(ip) as ip, created_at, last_seen_at, expires_at from sessions
      where user_id = ${userId} and expires_at > now() and last_seen_at > now() - ${SESSION_IDLE}::interval
      order by created_at`,
    db<
      {
        provider: string
        last4: string
        created_at: Date
        last_used_at: Date | null
        last_validated_at: Date | null
      }[]
    >`
      select provider, last4, created_at, last_used_at, last_validated_at from api_keys
      where user_id = ${userId} order by provider`,
    db<{ name: string; created_at: Date; last_used_at: Date | null; backed_up: boolean; transports: string[] }[]>`
      select name, created_at, last_used_at, backed_up, transports from passkeys
      where user_id = ${userId} order by created_at, id`,
    db<
      {
        name: string
        created_at: Date
        last_used_at: Date | null
        expires_at: Date
        ip: string | null
        user_agent: string | null
      }[]
    >`
      select name, created_at, last_used_at, expires_at, host(ip) as ip, user_agent from access_tokens
      where user_id = ${userId} and expires_at > now()
        and coalesce(last_used_at, created_at) > now() - ${SESSION_IDLE}::interval
      order by created_at, id`,
    db<
      {
        owner: string
        name: string
        ref: string | null
        added_at: Date
        opened_at: Date | null
        gone_at: Date | null
      }[]
    >`
      select owner, name, ref, added_at, opened_at, gone_at from github_repos
      where user_id = ${userId} order by added_at, id`,
    db<{ settings: Record<string, unknown> }[]>`select settings from reader_settings where user_id = ${userId}`,
    db<
      {
        id: string
        title: string
        author: string
        language: string
        status: string
        description: string | null
        isbn: string | null
        publisher: string | null
        published_year: number | null
        open_library_work: string | null
        created_at: Date
        ready_at: Date | null
        cover_source: string | null
        cover_width: number | null
        cover_height: number | null
        image_count: string
        format: 'audio' | null
        narrator: string | null
        audio_ms: string | null
        audio_bytes: string | null
        audio_files: number
        article_url: string | null
        article_words: number | null
      }[]
    >`
      select b.id, b.title, b.author, b.language, b.status, b.description, b.isbn, b.publisher, b.published_year,
        b.open_library_work, b.created_at, b.ready_at, b.format, b.narrator, b.audio_ms, b.audio_bytes,
        b.article_url, b.article_words,
        (select count(*)::int from user_book_audio_files f where f.book_id = b.id) as audio_files,
        c.source as cover_source, c.width as cover_width, c.height as cover_height,
        (select count(*) from user_book_images i where i.book_id = b.id) as image_count
      from user_books b left join user_book_covers c on c.book_id = b.id
      where b.user_id = ${userId}
      order by b.created_at`,
    db<{ book_id: string; title: string }[]>`
      select ch.book_id, ch.title from user_book_chapters ch
      join user_books b on b.id = ch.book_id
      where b.user_id = ${userId}
      order by ch.book_id, ch.position`,
    db<{ book_id: string; title: string; duration_ms: number }[]>`
      select c.book_id, c.title, c.duration_ms from user_book_audio_chapters c
      join user_books b on b.id = c.book_id
      where b.user_id = ${userId}
      order by c.book_id, c.position`,
    db<
      {
        book_slug: string | null
        user_book_id: string | null
        chapter: string | null
        page: number
        exact: string
        color: string
        note: string | null
        created_at: Date
        updated_at: Date
      }[]
    >`
      select book_slug, user_book_id, chapter, page, exact, color, note, created_at, updated_at from highlights
      where user_id = ${userId} order by created_at`,
    db<
      {
        book_slug: string | null
        user_book_id: string | null
        chapter: string | null
        page: number
        exact: string
        created_at: Date
      }[]
    >`
      select book_slug, user_book_id, chapter, page, exact, created_at from bookmarks
      where user_id = ${userId} order by created_at`,
    db<
      {
        book_slug: string | null
        user_book_id: string | null
        front: string
        back: string
        chapter: string | null
        page: number
        box: number
        due_at: Date
        created_at: Date
      }[]
    >`
      select book_slug, user_book_id, front, back, chapter, page, box, due_at, created_at from flashcards
      where user_id = ${userId} order by created_at, id`,
    db<
      {
        book_slug: string | null
        user_book_id: string | null
        kind: string
        episode: string | null
        position_ms: number | null
        chapter: string | null
        page: number | null
        exact: string | null
        created_at: Date
      }[]
    >`
      select book_slug, user_book_id, kind, episode, position_ms, chapter, page, exact, created_at
      from audio_bookmarks where user_id = ${userId} order by created_at`,
    db<
      {
        book_slug: string | null
        user_book_id: string | null
        chapter: string | null
        page: number
        at: Date
        device: string
      }[]
    >`
      select book_slug, user_book_id, chapter, page, at, device from reading_places
      where user_id = ${userId} order by at desc`,
    db<
      {
        book_slug: string | null
        user_book_id: string | null
        kind: string
        episode: string | null
        position_ms: number | null
        chapter: string | null
        page: number | null
        at: Date
        device: string
      }[]
    >`
      select book_slug, user_book_id, kind, episode, position_ms, chapter, page, at, device from listening_places
      where user_id = ${userId} order by at desc`,
    db<{ id: string; name: string; created_at: Date }[]>`
      select id, name, created_at from shelves where user_id = ${userId} order by name_key`,
    db<{ shelf_id: string; book_slug: string | null; user_book_id: string | null; added_at: Date }[]>`
      select shelf_id, book_slug, user_book_id, added_at from shelf_books
      where user_id = ${userId} order by added_at desc`,
    db<{ book_slug: string; removed_at: Date }[]>`
      select book_slug, removed_at from removed_books where user_id = ${userId} order by removed_at desc, book_slug`,
    db<{ book_slug: string | null; user_book_id: string | null; stars: number; rated_at: Date }[]>`
      select book_slug, user_book_id, stars, rated_at from book_ratings
      where user_id = ${userId} order by rated_at desc, book_slug, user_book_id`,
    db<
      {
        name: string
        applies_to: string
        instruction: string
        position: number
        created_at: Date
        updated_at: Date
      }[]
    >`
      select name, applies_to, instruction, position, created_at, updated_at from ask_prompts
      where user_id = ${userId} order by position, created_at, id`,
    db<{ minute: Date; characters: number; requests: number }[]>`
      select minute, characters, requests from speech_usage where user_id = ${userId} order by minute`,
    db<
      {
        status: string
        cadence: string
        founding: boolean
        period_ends_at: Date | null
        cancel_at: Date | null
        canceled_at: Date | null
        created_at: Date
      }[]
    >`
      select status, cadence, founding, period_ends_at, cancel_at, canceled_at, created_at from subscriptions
      where user_id = ${userId} order by created_at`,
    db<{ day: string; reading: string; listening: string }[]>`
      select day::text as day,
        coalesce(sum(seconds) filter (where kind = 'reading'), 0) as reading,
        coalesce(sum(seconds) filter (where kind = 'listening'), 0) as listening
      from reading_time where user_id = ${userId} group by day order by day desc`,
    db<{ book_slug: string | null; user_book_id: string | null; finished_at: Date }[]>`
      select book_slug, user_book_id, finished_at from finished_books
      where user_id = ${userId} order by finished_at desc, id`,
    db<{ from_day: string; minutes: number; set_at: Date }[]>`
      select from_day::text as from_day, minutes, set_at from reading_goals
      where user_id = ${userId} order by from_day desc`,
    db<{ event: string; at: Date; ip: string | null; detail: unknown }[]>`
      select event, at, host(ip) as ip, detail from audit_events
      where user_id = ${userId} order by at desc, id desc`,
  ])

  const chaptersOf = Map.groupBy(chapters, (c) => c.book_id)
  const audioChaptersOf = Map.groupBy(audioChapters, (c) => c.book_id)
  const key = (r: { book_slug: string | null; user_book_id: string | null }) => ({
    slug: r.book_slug,
    userBookId: r.user_book_id,
  })

  return {
    account: {
      username: account.username,
      role: account.role,
      createdAt: account.created_at,
      passwordChangedAt: account.password_changed_at,
      aiModel: account.ai_model,
      speechModel: account.speech_model,
      email: account.email,
      emailVerifiedAt: account.email_verified_at,
      emailBouncedAt: account.email_bounced_at,
      timeZone: account.time_zone,
    },
    sessions: sessions.map((session) => ({
      userAgent: session.user_agent,
      ip: session.ip,
      createdAt: session.created_at,
      lastSeenAt: session.last_seen_at,
      expiresAt: session.expires_at,
    })),
    apiKeys: apiKeys.map((apiKey) => ({
      provider: apiKey.provider,
      last4: apiKey.last4,
      createdAt: apiKey.created_at,
      lastUsedAt: apiKey.last_used_at,
      lastValidatedAt: apiKey.last_validated_at,
    })),
    passkeys: passkeys.map((passkey) => ({
      name: passkey.name,
      createdAt: passkey.created_at,
      lastUsedAt: passkey.last_used_at,
      backedUp: passkey.backed_up,
      transports: passkey.transports,
    })),
    accessTokens: accessTokens.map((accessToken) => ({
      name: accessToken.name,
      createdAt: accessToken.created_at,
      lastUsedAt: accessToken.last_used_at,
      expiresAt: accessToken.expires_at,
      ip: accessToken.ip,
      userAgent: accessToken.user_agent,
    })),
    githubRepos: githubRepos.map((repo) => ({
      owner: repo.owner,
      name: repo.name,
      ref: repo.ref,
      addedAt: repo.added_at,
      openedAt: repo.opened_at,
      goneAt: repo.gone_at,
    })),
    readerSettings: settings[0]?.settings ?? null,
    privateBooks: books.map((book) => ({
      id: book.id,
      title: book.title,
      author: book.author,
      language: book.language,
      status: book.status,
      chapters: chaptersOf.get(book.id)?.map((c) => c.title) ?? [],
      description: book.description,
      isbn: book.isbn,
      publisher: book.publisher,
      publishedYear: book.published_year,
      openLibraryWork: book.open_library_work,
      cover:
        book.cover_source === null
          ? null
          : { source: book.cover_source, width: book.cover_width ?? 0, height: book.cover_height ?? 0 },
      imageCount: Number(book.image_count),
      articleUrl: book.article_url,
      articleWords: book.article_words,
      audio:
        book.format === 'audio'
          ? {
              narrator: book.narrator,
              lengthMs: Number(book.audio_ms ?? 0),
              bytes: Number(book.audio_bytes ?? 0),
              files: book.audio_files,
              chapters: audioChaptersOf.get(book.id)?.map((c) => ({ title: c.title, durationMs: c.duration_ms })) ?? [],
            }
          : null,
      createdAt: book.created_at,
      readyAt: book.ready_at,
    })),
    highlights: highlights.map((h) => ({
      ...key(h),
      chapter: h.chapter,
      page: h.page,
      text: h.exact,
      color: h.color,
      note: h.note,
      createdAt: h.created_at,
      updatedAt: h.updated_at,
    })),
    bookmarks: bookmarks.map((bookmark) => ({
      ...key(bookmark),
      chapter: bookmark.chapter,
      page: bookmark.page,
      text: bookmark.exact,
      createdAt: bookmark.created_at,
    })),
    flashcards: flashcards.map((flashcard) => ({
      ...key(flashcard),
      front: flashcard.front,
      back: flashcard.back,
      chapter: flashcard.chapter,
      page: flashcard.page,
      box: flashcard.box,
      dueAt: flashcard.due_at,
      createdAt: flashcard.created_at,
    })),
    audioBookmarks: audioBookmarks.map((audioBookmark) => ({
      ...key(audioBookmark),
      kind: audioBookmark.kind,
      episode: audioBookmark.episode,
      positionMs: audioBookmark.position_ms,
      chapter: audioBookmark.chapter,
      page: audioBookmark.page,
      text: audioBookmark.exact,
      createdAt: audioBookmark.created_at,
    })),
    readingPlaces: readingPlaces.map((readingPlace) => ({
      ...key(readingPlace),
      chapter: readingPlace.chapter,
      page: readingPlace.page,
      at: readingPlace.at,
      device: readingPlace.device,
    })),
    listeningPlaces: listeningPlaces.map((listeningPlace) => ({
      ...key(listeningPlace),
      kind: listeningPlace.kind,
      episode: listeningPlace.episode,
      positionMs: listeningPlace.position_ms,
      chapter: listeningPlace.chapter,
      page: listeningPlace.page,
      at: listeningPlace.at,
      device: listeningPlace.device,
    })),
    shelves: shelves.map((shelf) => ({
      id: shelf.id,
      name: shelf.name,
      createdAt: shelf.created_at,
      books: shelfBooks.filter((b) => b.shelf_id === shelf.id).map((b) => ({ ...key(b), addedAt: b.added_at })),
    })),
    removedBooks: removedBooks.map((r) => ({ slug: r.book_slug, userBookId: null, removedAt: r.removed_at })),
    ratings: ratings.map((r) => ({ ...key(r), stars: r.stars, ratedAt: r.rated_at })),
    askPrompts: askPrompts.map((askPrompt) => ({
      name: askPrompt.name,
      appliesTo: askPrompt.applies_to,
      instruction: askPrompt.instruction,
      position: askPrompt.position,
      createdAt: askPrompt.created_at,
      updatedAt: askPrompt.updated_at,
    })),
    speechUsage,
    subscriptions: subscriptions.map((subscription) => ({
      status: subscription.status,
      cadence: subscription.cadence,
      founding: subscription.founding,
      periodEndsAt: subscription.period_ends_at,
      cancelAt: subscription.cancel_at,
      canceledAt: subscription.canceled_at,
      createdAt: subscription.created_at,
    })),
    readingTime: readingTime.map((r) => ({
      day: r.day,
      readingSeconds: Number(r.reading),
      listeningSeconds: Number(r.listening),
    })),
    finishedBooks: finishedBooks.map((f) => ({ ...key(f), finishedAt: f.finished_at })),
    readingGoals: readingGoals.map((g) => ({ fromDay: g.from_day, minutes: g.minutes, setAt: g.set_at })),
    activity,
  }
}
