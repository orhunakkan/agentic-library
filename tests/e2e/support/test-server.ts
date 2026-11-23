import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import postgres from 'postgres'
import { migrate } from '../../../scripts/db/migrate.ts'
import { startServer } from '../../../scripts/serve.ts'
import { startSession } from '../../../src/server/account-actions.ts'
import { hashPassword } from '../../../src/server/passwords.ts'
import { FOLIO_VOICES, filesOfVoice, voiceFileName } from '../../../src/shared/read-aloud/folio-voices.ts'
import { databaseName, withDatabase } from '../../test-databases.ts'
import { anthropicStub } from './anthropic-stub.ts'
import { articlesStub } from './articles-stub.ts'
import { elevenLabsStub } from './elevenlabs-stub.ts'
import { githubStub } from './github-stub.ts'
import { openLibraryStub } from './open-library-stub.ts'
import { paddleStub } from './paddle-stub.ts'
import { SEEDED } from './seed.ts'
import { wikimediaStub } from './wikimedia-stub.ts'

function silentWav(seconds = 120, rate = 8000): Uint8Array<ArrayBuffer> {
  const samples = seconds * rate
  const buf = Buffer.alloc(44 + samples)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate, 28)
  buf.writeUInt16LE(1, 32)
  buf.writeUInt16LE(8, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples, 40)
  buf.fill(128, 44)
  const bytes = new Uint8Array(buf.length)
  bytes.set(buf)
  return bytes
}

const WAV = silentWav()

function audioResponse(request: Request): Response {
  const headers = { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'cache-control': 'no-store' }
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
  if (!range) return new Response(WAV, { headers: { ...headers, 'content-length': String(WAV.length) } })
  const start = range[1] ? Number(range[1]) : Math.max(0, WAV.length - Number(range[2]))
  const end = range[1] && range[2] ? Math.min(Number(range[2]), WAV.length - 1) : WAV.length - 1
  if (start > end || start >= WAV.length) {
    return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${WAV.length}` } })
  }
  return new Response(WAV.slice(start, end + 1), {
    status: 206,
    headers: {
      ...headers,
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${WAV.length}`,
    },
  })
}

const url = process.env.DATABASE_URL ?? ''
const database = databaseName(url)
if (!/^[a-z0-9_]+_test$/.test(database)) {
  throw new Error(`The e2e server needs DATABASE_URL to name a database ending in _test (got "${database}")`)
}
const server = postgres(withDatabase(url, 'postgres'), { max: 1, onnotice: () => {} })
try {
  const [found] = await server`select 1 from pg_database where datname = ${database}`
  if (!found) await server.unsafe(`create database "${database}"`)
} finally {
  await server.end()
}
await migrate({ url })
const sql = postgres(url, { max: 2, onnotice: () => {} })
await sql`truncate users, sessions, login_attempts, api_keys, audit_events, user_books, user_book_covers, user_book_images, user_book_audio_files, user_book_audio_chapters, highlights, bookmarks, flashcards, audio_bookmarks, reading_places, listening_places, reader_settings, shelves, shelf_books, removed_books, email_tokens, signup_tokens, speech_usage, subscriptions, paddle_events, passkeys, passkey_challenges, access_tokens, github_repos, reading_time, finished_books, reading_goals, book_ratings, ask_prompts restart identity cascade`
for (const user of Object.values(SEEDED)) {
  await sql`
    insert into users (username, password_hash, role, pro_granted_at)
    values (${user.username}, ${await hashPassword(user.password)}, ${user.role},
      ${user.role === 'member' ? new Date() : null})`
}

async function createTestUser(request: Request): Promise<Response> {
  const {
    role = 'member',
    signedIn = false,
    plan = 'pro',
  } = (await request.json().catch(() => ({}))) as {
    role?: string
    signedIn?: boolean
    plan?: 'free' | 'pro'
  }
  const username = `e2e-${randomBytes(6).toString('hex')}`
  const password = `e2e password ${randomBytes(6).toString('hex')}`
  const [user] = await sql<{ id: number }[]>`
    insert into users (username, password_hash, role, pro_granted_at)
    values (${username}, ${await hashPassword(password)}, ${role},
      ${plan === 'pro' && role === 'member' ? new Date() : null})
    returning id`
  if (!user) throw new Error('/test-users: the insert returned no row')
  const headers = signedIn ? { 'set-cookie': await startSession(sql, request, user.id) } : undefined
  return Response.json({ username, password }, { headers })
}

const mailDir = mkdtempSync(join(tmpdir(), 'folio-e2e-mail-'))
process.env.MAIL_TRANSPORT = 'capture'
process.env.MAIL_FROM = 'Folio <no-reply@folio.test>'
process.env.MAIL_CAPTURE_DIR = mailDir
process.env.SIGNUP = 'open'
process.env.SITE_CONTACT = 'privacy@folio.test'

function voicesForTests(): string {
  const real = resolve(process.env.VOICES_DIR?.trim() || '.cache/voices')
  const dir = mkdtempSync(join(tmpdir(), 'folio-e2e-voices-'))
  for (const voice of FOLIO_VOICES) {
    for (const file of filesOfVoice(voice)) {
      const name = voiceFileName(file, voice.id)
      const source = join(real, name)
      if (existsSync(source) && statSync(source).size === file.bytes) symlinkSync(source, join(dir, name))
      else writeFileSync(join(dir, name), name.endsWith('.json') ? '{}' : `dummy ${name}\n`)
    }
  }
  return dir
}
process.env.VOICES_DIR = voicesForTests()
process.env.AUDIOBOOKS_DIR = mkdtempSync(join(tmpdir(), 'folio-e2e-audiobooks-'))

function capturedMail(request: Request): Response {
  const to = (new URL(request.url).searchParams.get('to') ?? '').toLowerCase()
  const messages = readdirSync(mailDir)
    .map((name) => JSON.parse(readFileSync(join(mailDir, name), 'utf8')) as { to: string; at: string })
    .filter((m) => m.to.toLowerCase() === to)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return Response.json(messages, { headers: { 'cache-control': 'no-store' } })
}

const paddle = paddleStub(
  new URL(process.env.PADDLE_API_BASE ?? 'http://127.0.0.1').origin,
  process.env.PADDLE_WEBHOOK_SECRET ?? '',
  {
    founding: process.env.PADDLE_PRICE_FOUNDING ?? '',
  },
)

await startServer([
  (request, next) => {
    const path = new URL(request.url).pathname
    if (path.startsWith('/test-audio/')) return audioResponse(request)
    if (path.startsWith('/test-anthropic/')) return anthropicStub(request)
    if (path.startsWith('/test-elevenlabs/')) return elevenLabsStub(request)
    if (path.startsWith('/test-open-library/')) return openLibraryStub(request)
    if (path.startsWith('/test-wikimedia/')) return wikimediaStub(request)
    if (path.startsWith('/test-github/')) return githubStub(request)
    if (path.startsWith('/test-articles/')) return articlesStub(request)
    if (path.startsWith('/test-paddle/')) return paddle(request)
    if (path === '/test-users' && request.method === 'POST') return createTestUser(request)
    if (path === '/test-mail/messages') return capturedMail(request)
    return next()
  },
])
