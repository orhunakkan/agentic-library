import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR, migrate, readMigrations } from '../../scripts/db/migrate'
import { databaseUrl, freshDatabase } from './testing/db'

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} })
afterAll(() => sql.end())

const tables = async () =>
  (
    await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables where table_schema = 'public' order by table_name`
  ).map((r) => r.table_name)

describe('migrations', () => {
  beforeEach(async () => {
    await sql.unsafe('drop schema public cascade; create schema public').simple()
  })

  it('run from empty and create every table', async () => {
    const applied = await migrate({ url: databaseUrl })
    expect(applied).toEqual(readMigrations().map((m) => m.name))
    expect(await tables()).toEqual([
      'access_tokens',
      'api_keys',
      'ask_prompts',
      'audio_bookmarks',
      'audit_events',
      'book_ratings',
      'bookmarks',
      'email_tokens',
      'finished_books',
      'flashcards',
      'github_repos',
      'highlights',
      'listening_places',
      'login_attempts',
      'passkey_challenges',
      'passkeys',
      'reader_settings',
      'reading_goals',
      'reading_places',
      'reading_time',
      'removed_books',
      'schema_migrations',
      'sessions',
      'shelf_books',
      'shelves',
      'signup_tokens',
      'speech_usage',
      'user_book_audio_chapters',
      'user_book_audio_files',
      'user_book_chapters',
      'user_book_covers',
      'user_book_images',
      'user_books',
      'users',
    ])
  })

  it('take ElevenLabs and OpenAI keys beside Anthropic ones, and no other provider', async () => {
    await migrate({ url: databaseUrl })
    const [user] = await sql<{ id: string }[]>`
      insert into users (username, password_hash, role) values ('reader', 'x', 'member') returning id`
    const key = (provider: string) => sql`
      insert into api_keys (user_id, provider, ciphertext, iv, auth_tag, kek_id, last4)
      values (${user?.id ?? 0}, ${provider}, ${Buffer.alloc(1)}, ${Buffer.alloc(12)}, ${Buffer.alloc(16)}, 1, 'abcd')`
    await key('anthropic')
    await key('elevenlabs')
    await key('openai')
    await expect(key('gemini')).rejects.toThrow(/api_keys_provider_check/)
  })

  it('let an episode bookmark and place belong to a private audiobook, once each', async () => {
    await migrate({ url: databaseUrl })
    const [user] = await sql<{ id: string }[]>`
      insert into users (username, password_hash, role) values ('listener', 'x', 'member') returning id`
    const userId = user?.id ?? 0
    const [book] = await sql<{ id: string }[]>`
      insert into user_books (user_id, title, author, language, chapter_count, format, audio_ms, audio_bytes)
      values (${userId}, 'Heard', 'An Author', 'en', 2, 'audio', 9000, 36000) returning id`
    const bookId = book?.id ?? ''
    const bookmark = (slug: string | null, id: string | null) => sql`
      insert into audio_bookmarks (user_id, book_slug, user_book_id, kind, episode, position_ms)
      values (${userId}, ${slug}, ${id}, 'episode', '2', 4000)`
    await bookmark(null, bookId)
    await bookmark('a-catalogue-book', null)
    await expect(bookmark(null, bookId)).rejects.toThrow(/audio_bookmarks_episode_book_idx/)
    await expect(bookmark(null, null)).rejects.toThrow(/check/)
    const place = (id: string | null, episode: string) => sql`
      insert into listening_places (user_id, user_book_id, kind, episode, position_ms, at, device)
      values (${userId}, ${id}, 'episode', ${episode}, 1000, now(), 'Firefox on Linux')`
    await place(bookId, '1')
    await expect(place(bookId, '1')).rejects.toThrow(/listening_places_episode_book_idx/)
    const checks = await sql<{ table: string }[]>`
      select conrelid::regclass::text as table from pg_constraint
      where contype = 'c' and conrelid in ('audio_bookmarks'::regclass, 'listening_places'::regclass)
        and pg_get_constraintdef(oid) like '%kind <> ''episode''::text%'`
    expect(checks.map((c) => c.table).sort()).toEqual(['audio_bookmarks', 'listening_places'])
  })

  it('mark the starter books the previous release gave, and nothing else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'))
    try {
      for (const m of readMigrations().filter((m) => m.name < '0018')) writeFileSync(join(dir, m.name), m.sql)
      await migrate({ url: databaseUrl, dir })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const user = async (name: string) => {
      const [row] = await sql<{ id: string }[]>`
        insert into users (username, password_hash, role) values (${name}, 'x', 'member') returning id`
      return row?.id ?? ''
    }
    const book = (tx: postgres.Sql | postgres.TransactionSql, userId: string) => tx`
      insert into user_books (user_id, title, author, language, status, chapter_count, html_bytes, ready_at)
      values (${userId}, 'Pride and Prejudice', 'Jane Austen', 'en-GB', 'ready', 1, 10, now())`
    const given = await user('given')
    await sql.begin(async (tx) => {
      await book(tx, given)
      await tx`update users set starter_book_at = now() where id = ${given}`
    })
    await book(sql, given)
    const removed = await user('removed')
    await sql`update users set starter_book_at = now() where id = ${removed}`
    await book(sql, removed)

    await migrate({ url: databaseUrl })
    const rows = await sql<{ username: string; starter: boolean }[]>`
      select u.username, b.starter from user_books b join users u on u.id = b.user_id order by b.created_at`
    expect(rows).toEqual([
      { username: 'given', starter: true },
      { username: 'given', starter: false },
      { username: 'removed', starter: false },
    ])
    await book(sql, removed)
    const [late] = await sql<{ starter: boolean }[]>`select starter from user_books order by created_at desc limit 1`
    expect(late?.starter).toBe(false)
  })

  it('add articles to the previous release’s books and audiobooks, all of them not articles', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'))
    try {
      for (const m of readMigrations().filter((m) => m.name < '0027')) writeFileSync(join(dir, m.name), m.sql)
      await migrate({ url: databaseUrl, dir })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const [user] = await sql<{ id: string }[]>`
      insert into users (username, password_hash, role) values ('reader', 'x', 'member') returning id`
    await sql`
      insert into user_books (user_id, title, author, language, chapter_count, format)
      values (${user?.id ?? ''}, 'A book', 'a', 'en', 1, null), (${user?.id ?? ''}, 'Heard', 'a', 'en', 1, 'audio')`
    await migrate({ url: databaseUrl })
    const rows = await sql<{ article_url: string | null; article_words: number | null }[]>`
      select article_url, article_words from user_books order by title`
    expect(rows).toEqual([
      { article_url: null, article_words: null },
      { article_url: null, article_words: null },
    ])
    const [check] = await sql<{ validated: boolean }[]>`
      select convalidated as validated from pg_constraint where conname = 'user_books_article_not_audio'`
    expect(check?.validated).toBe(true)
    const indexes = await sql`select 1 from pg_indexes where indexname = 'user_books_article_idx'`
    expect(indexes).toHaveLength(1)
  })

  it('drop the billing tables and grant columns, and keep the users, books and audit events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'))
    try {
      for (const m of readMigrations().filter((m) => m.name < '0029')) writeFileSync(join(dir, m.name), m.sql)
      await migrate({ url: databaseUrl, dir })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const [granter] = await sql<{ id: string }[]>`
      insert into users (username, password_hash, role) values ('granter', 'x', 'admin') returning id`
    const [granted] = await sql<{ id: string }[]>`
      insert into users (username, password_hash, role, starter_book_at, pro_granted_at, pro_granted_by)
      values ('granted', 'y', 'member', '2026-11-01T12:00:00Z', now(), ${granter?.id ?? ''}) returning id`
    const grantedId = granted?.id ?? ''
    await sql`
      insert into user_books (user_id, title, author, language, chapter_count, starter)
      values (${grantedId}, 'Pride and Prejudice', 'Jane Austen', 'en-GB', 1, true)`
    await sql`
      insert into audit_events (user_id, event, detail)
      values (${grantedId}, 'plan.granted', ${sql.json({ by: 'granter' })})`
    await sql`
      insert into subscriptions (id, user_id, customer_id, price_id, cadence, founding, status, event_at)
      values ('sub_01abc', ${grantedId}, 'ctm_01abc', 'pri_01monthly', 'month', true, 'active', now())`
    await sql`
      insert into paddle_events (event_id, event_type, occurred_at)
      values ('evt_01abc', 'subscription.created', now())`
    const kept = () =>
      Promise.all([
        sql`select id, username, password_hash, role, created_at, starter_book_at from users order by id`,
        sql`select id, user_id, title, starter from user_books order by id`,
        sql`select id, user_id, event, at, detail from audit_events order by id`,
      ])
    const before = await kept()

    await migrate({ url: databaseUrl })
    const remaining = await tables()
    expect(remaining).not.toContain('subscriptions')
    expect(remaining).not.toContain('paddle_events')
    const columns = async (table: string) =>
      (
        await sql<{ column_name: string }[]>`
          select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table}`
      ).map((c) => c.column_name)
    const userColumns = await columns('users')
    expect(userColumns).not.toContain('pro_granted_at')
    expect(userColumns).not.toContain('pro_granted_by')
    expect(userColumns).toContain('starter_book_at')
    expect(await columns('user_books')).toContain('starter')
    expect(await kept()).toEqual(before)
    expect(before.map((rows) => rows.length)).toEqual([2, 1, 1])
  })

  it('are idempotent', async () => {
    await migrate({ url: databaseUrl })
    expect(await migrate({ url: databaseUrl })).toEqual([])
    const [row] = await sql<{ n: string }[]>`select count(*) as n from schema_migrations`
    expect(Number(row?.n)).toBe(readMigrations().length)
  })

  it('refuse to start when an applied file has changed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'))
    try {
      cpSync(MIGRATIONS_DIR, dir, { recursive: true })
      await migrate({ url: databaseUrl, dir })
      const [first] = readMigrations(dir)
      writeFileSync(join(dir, first?.name ?? ''), `${first?.sql}\n-- edited after it ran\n`)
      writeFileSync(join(dir, '9999_later.sql'), 'create table later (id int);')
      await expect(migrate({ url: databaseUrl, dir })).rejects.toThrow(/has changed/)
      expect(await tables()).not.toContain('later')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('roll a failing file back completely', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'))
    try {
      writeFileSync(join(dir, '0001_ok.sql'), 'create table ok (id int);')
      writeFileSync(join(dir, '0002_broken.sql'), 'create table half (id int); select * from missing_table;')
      await expect(migrate({ url: databaseUrl, dir })).rejects.toThrow()
      expect(await tables()).toEqual(['ok', 'schema_migrations'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('create objects as the owner role when one is given', async () => {
    await sql`drop role if exists agentic_migrate_test_owner`
    await sql`create role agentic_migrate_test_owner nologin`
    await sql`grant usage, create on schema public to agentic_migrate_test_owner`
    try {
      await migrate({ url: databaseUrl, role: 'agentic_migrate_test_owner' })
      const owners = await sql<{ tableowner: string }[]>`
        select distinct tableowner from pg_tables where schemaname = 'public'`
      expect(owners.map((o) => o.tableowner)).toEqual(['agentic_migrate_test_owner'])
    } finally {
      await sql.unsafe('drop schema public cascade; create schema public').simple()
      await sql`drop role agentic_migrate_test_owner`
    }
  })

  afterAll(freshDatabase)
})
