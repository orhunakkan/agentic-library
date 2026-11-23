import type { Sql } from 'postgres'

export const PASSWORD_HASH = '$argon2id$v=19$m=1024,t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2g'
export const KEY_CIPHERTEXT = Buffer.from('ciphertext-that-must-not-leak')

export interface FilledUser {
  userId: number
  username: string
  bookId: string
  audiobookId: string
  shelfId: string
}

export async function userWithEveryRow(raw: Sql, username: string, role = 'member'): Promise<FilledUser> {
  const [user] = await raw<{ id: string }[]>`
    insert into users (username, password_hash, role, ai_model, email, email_verified_at)
    values (${username}, ${PASSWORD_HASH}, ${role}, 'claude-haiku-5-5', ${`${username}@example.com`}, now())
    returning id`
  const userId = Number(user?.id)
  const mark = `${username}-mark`

  await raw`
    insert into sessions (token_hash, user_id, expires_at, ip, user_agent)
    values (${Buffer.from(`${username}-token-hash`)}, ${userId}, now() + interval '30 days', '203.0.113.5',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15')`
  await raw`
    insert into api_keys (user_id, provider, ciphertext, iv, auth_tag, kek_id, last4)
    values (${userId}, 'anthropic', ${KEY_CIPHERTEXT}, ${Buffer.alloc(12, 1)}, ${Buffer.alloc(16, 2)}, 1, 'ab12')`
  await raw`
    insert into email_tokens (token_hash, user_id, purpose, email, expires_at)
    values (${Buffer.from(`${username}-email-token-hash`)}, ${userId}, 'verify', ${`${username}-pending@example.com`},
      now() + interval '1 day')`
  await raw`
    insert into signup_tokens (token_hash, kind, note, created_by, expires_at)
    values (${Buffer.from(`${username}-invite-hash`)}, 'invite', ${`${mark} invite`}, ${userId}, now() + interval '7 days')`
  await raw`insert into login_attempts (username, ip, succeeded) values (${username}, '203.0.113.5', false)`
  await raw`
    insert into audit_events (user_id, event, ip, detail)
    values (${userId}, 'login.succeeded', '203.0.113.5', '{}'), (${userId}, 'logout', '203.0.113.5', '{}')`

  const [book] = await raw<{ id: string }[]>`
    insert into user_books (user_id, title, author, language, status, chapter_count, html_bytes, ready_at,
      description, image_count, image_bytes)
    values (${userId}, ${`${mark} book`}, 'Ada', 'en', 'ready', 1, 10, now(), null, 1, 4)
    returning id`
  const bookId = book?.id as string
  await raw`
    insert into user_book_chapters (book_id, position, slug, title, pages)
    values (${bookId}, 0, 'one', 'Chapter one', ${raw.json([`<p>${mark} page text</p>`])})`
  await raw`
    insert into user_book_covers (book_id, media_type, bytes, width, height, source, sha256)
    values (${bookId}, 'image/png', ${Buffer.from('cover-bytes')}, 600, 900, 'epub', ${'a'.repeat(64)})`
  await raw`
    insert into user_book_images (book_id, n, media_type, bytes, width, height, sha256)
    values (${bookId}, 1, 'image/png', ${Buffer.from('pict')}, 20, 20, ${'b'.repeat(64)})`

  const [audiobook] = await raw<{ id: string }[]>`
    insert into user_books (user_id, title, author, language, status, chapter_count, ready_at, format, narrator,
      audio_ms, audio_bytes)
    values (${userId}, ${`${mark} audiobook`}, 'Ada', 'en', 'ready', 1, now(), 'audio', 'Rex Reader', 9000, 36000)
    returning id`
  const audiobookId = audiobook?.id as string
  await raw`
    insert into user_book_audio_files (book_id, n, media_type, bytes, received, duration_ms)
    values (${audiobookId}, 1, 'audio/mp4', 36000, 36000, 9000)`
  await raw`
    insert into user_book_audio_chapters (book_id, position, title, file_n, start_ms, duration_ms)
    values (${audiobookId}, 1, ${`${mark} audio chapter`}, 1, 0, 9000)`

  await raw`
    insert into highlights (user_id, book_slug, chapter, page, start_offset, end_offset, exact, prefix, suffix, color,
      note)
    values (${userId}, 'pride-and-prejudice', 'chapter-1', 1, 0, 9, ${`${mark} highlight`}, 'pre', 'suf', 'yellow',
      ${`${mark} note`})`
  await raw`
    insert into bookmarks (user_id, user_book_id, chapter, page, start_offset, end_offset, exact)
    values (${userId}, ${bookId}, 'one', 1, 0, 5, ${`${mark} bm`})`
  await raw`
    insert into flashcards (user_id, book_slug, chapter, page, front, back, origin)
    values (${userId}, 'pride-and-prejudice', 'chapter-1', 1, ${`${mark} card front`}, ${`${mark} card back`}, 'quiz')`
  await raw`
    insert into audio_bookmarks (user_id, book_slug, kind, episode, position_ms)
    values (${userId}, 'fixture-audio-book', 'episode', 'episode-1', 61000)`
  await raw`
    insert into reading_places (user_id, book_slug, chapter, page, at, device)
    values (${userId}, 'pride-and-prejudice', 'chapter-1', 3, now(), 'Safari on Mac')`
  await raw`
    insert into listening_places (user_id, user_book_id, kind, chapter_index, chapter, page, start_offset, at, device)
    values (${userId}, ${bookId}, 'voice', 0, 'one', 1, 0, now(), 'Safari on Mac')`
  await raw`
    insert into reader_settings (user_id, settings, at, device)
    values (${userId}, ${raw.json({ theme: 'dark', font: 'literata', leading: 'normal', measure: 'normal' })}, now(),
      'Safari on Mac')`
  const [shelf] = await raw<{ id: string }[]>`
    insert into shelves (user_id, name, name_key) values (${userId}, ${`${mark} shelf`}, ${`${mark} shelf`})
    returning id`
  const shelfId = shelf?.id as string
  await raw`
    insert into shelf_books (shelf_id, user_id, book_slug) values (${shelfId}, ${userId}, 'pride-and-prejudice')`
  await raw`insert into shelf_books (shelf_id, user_id, user_book_id) values (${shelfId}, ${userId}, ${bookId})`
  await raw`insert into removed_books (user_id, book_slug) values (${userId}, 'pride-and-prejudice')`
  await raw`insert into book_ratings (user_id, book_slug, stars) values (${userId}, 'pride-and-prejudice', 4)`
  await raw`insert into book_ratings (user_id, user_book_id, stars) values (${userId}, ${bookId}, 2)`
  await raw`
    insert into ask_prompts (user_id, name, applies_to, instruction, position)
    values (${userId}, ${`${mark} prompt`}, 'pages', 'List who has come up so far.', 0)`
  await raw`
    insert into github_repos (user_id, github_id, owner, name, default_branch, commit_sha)
    values (${userId}, 1001, 'folio-test', 'sample', 'main', repeat('1', 40))`
  await raw`
    insert into speech_usage (user_id, minute, characters, requests)
    values (${userId}, date_trunc('minute', now()), 321, 3)`
  await raw`update users set time_zone = 'Europe/Istanbul' where id = ${userId}`
  await raw`
    insert into reading_time (user_id, id, kind, day, seconds)
    values (${userId}, gen_random_uuid(), 'reading', '2026-11-20', 1234)`
  await raw`insert into finished_books (user_id, user_book_id) values (${userId}, ${bookId})`
  await raw`insert into reading_goals (user_id, from_day, minutes) values (${userId}, '2026-11-01', 30)`
  await raw`
    insert into subscriptions (id, user_id, customer_id, price_id, cadence, founding, status, canceled_at, event_at)
    values (${`sub_01${username.replace(/[^a-z0-9]/g, '')}`}, ${userId}, ${`ctm_01${username.replace(/[^a-z0-9]/g, '')}`},
      'pri_01founding', 'year', true, 'canceled', now(), now())`

  return { userId, username, bookId, audiobookId, shelfId }
}

export const ROWS_PER_USER = {
  sessions: 1,
  api_keys: 1,
  email_tokens: 1,
  signup_tokens: 1,
  login_attempts: 1,
  user_books: 2,
  user_book_chapters: 1,
  user_book_audio_files: 1,
  user_book_audio_chapters: 1,
  user_book_covers: 1,
  user_book_images: 1,
  highlights: 1,
  bookmarks: 1,
  flashcards: 1,
  audio_bookmarks: 1,
  reading_places: 1,
  listening_places: 1,
  reader_settings: 1,
  shelves: 1,
  shelf_books: 2,
  removed_books: 1,
  book_ratings: 2,
  ask_prompts: 1,
  github_repos: 1,
  speech_usage: 1,
  reading_time: 1,
  finished_books: 1,
  reading_goals: 1,
} as const

export const KEPT_WITHOUT_USER = { subscriptions: 1 } as const
