import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../support/fixtures'

const SERVER_ONLY = [
  'api_key:v1',
  'aes-256-gcm',
  'withApiKey',
  'argon2',
  'password_hash',
  'token_hash',
  'statement_timeout',
  'x-api-key',
  'xi-api-key',
  'insert into speech_usage',
  'CREDENTIALS_DIRECTORY',
  'user_book_chapters',
  'jsonb_array_length',
  'book.imported',
  'book.asked',
  'server-side-fallback',
  'You answer a reader',
  'ai_model',
  'start_offset',
  'user_book_id',
  'insert into bookmarks',
  'insert into passkeys',
  'insert into access_tokens',
  'webauthn_user_id',
  'Response counter value',
  'insert into flashcards',
  'Write a quiz of',
  'insert into audio_bookmarks',
  'insert into user_book_images',
  'user_book_audio_files',
  'article_url',
  'BlockList',
  'insert into reading_places',
  'insert into user_book_covers',
  'insert into shelf_books',
  'insert into removed_books',
  'insert into book_ratings',
  'insert into ask_prompts',
  '<reader-prompt>',
  'insert into reading_time',
  'delete from users where',
  'pro_granted_at',
  'folio-account',
  'offline download',
  '/search.json',
  'These are the passages the reader highlighted',
  'rest_v1/page/definition',
  'You translate text from a book',
  'x-stainless-lang',
  'OpenAI response failed',
  'context_length_exceeded',
  'insert into email_tokens',
  'insert into subscriptions',
  'portal-sessions',
  'paddle-signature',
  'insert into signup_tokens',
  'svix-signature',
  'insert into github_repos',
  'x-ratelimit-remaining',
  'createHighlighterCore',
  'nameToEmoji',
]

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  )
}

test('server-only account code stays out of the client bundle', () => {
  const scripts = files('dist/client').filter((f) => /\.(js|mjs|css|html)$/.test(f))
  expect(scripts.length).toBeGreaterThan(0)
  const leaks = scripts.flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    return SERVER_ONLY.filter((needle) => text.includes(needle)).map((needle) => `${file}: ${needle}`)
  })
  expect(leaks).toEqual([])
})

const ENGINE_ONLY = ['InferenceSession', 'expectedDataFileDownloads']

test('the Folio voice’s engine is only in its worker', () => {
  const scripts = files('dist/client').filter((f) => /\.(js|mjs)$/.test(f))
  const worker = scripts.filter((f) => /piper\.worker-[^/]+\.js$/.test(f))
  expect(worker).toHaveLength(1)
  const inWorker = readFileSync(worker[0] as string, 'utf8')
  for (const needle of ENGINE_ONLY) expect(inWorker, needle).toContain(needle)
  const leaks = scripts
    .filter((f) => !worker.includes(f))
    .flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      return ENGINE_ONLY.filter((needle) => text.includes(needle)).map((needle) => `${file}: ${needle}`)
    })
  expect(leaks).toEqual([])
})

test('Run code’s engines stay out of the reader’s chunks', () => {
  const assets = files('dist/client/assets')
  const scripts = assets.filter((f) => /\.(js|mjs)$/.test(f))
  const withSucrase = scripts.filter((f) => readFileSync(f, 'utf8').includes('Unexpectedly reached end of input.'))
  expect(withSucrase).toHaveLength(1)
  expect(readFileSync(withSucrase[0] as string, 'utf8')).not.toContain('createRoot')
  const engines = assets.filter((f) => {
    const text = /\.(js|mjs)$/.test(f) ? readFileSync(f, 'utf8') : ''
    return /pyodide|sqlite/i.test(f) || text.includes('PyProxy') || text.includes('sqlite3_wasmfs_opfs_dir')
  })
  expect(engines).toEqual([])
  expect(files('dist/client/run-code').length).toBeGreaterThan(0)
})
