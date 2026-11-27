import type { Sql } from 'postgres'

export async function readyAudiobook(raw: Sql, userId: number, lengths: readonly number[] = [60_000, 90_000]) {
  const total = lengths.reduce((n, ms) => n + ms, 0)
  const [book] = await raw<{ id: string }[]>`
    insert into user_books (user_id, title, author, language, status, chapter_count, ready_at, format, audio_ms,
      audio_bytes)
    values (${userId}, 'Heard', 'Ada', 'en', 'ready', ${lengths.length}, now(), 'audio', ${total}, 1000)
    returning id`
  const id = book?.id as string
  await raw`
    insert into user_book_audio_files (book_id, n, media_type, bytes, received, duration_ms)
    values (${id}, 1, 'audio/mp4', 1000, 1000, ${Math.max(1000, total)})`
  let start = 0
  for (const [i, ms] of lengths.entries()) {
    await raw`
      insert into user_book_audio_chapters (book_id, position, title, file_n, start_ms, duration_ms)
      values (${id}, ${i + 1}, ${`Chapter ${i + 1}`}, 1, ${start}, ${ms})`
    start += ms
  }
  return id
}
