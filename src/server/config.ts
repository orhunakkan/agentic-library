import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { SIGNUP_MODES, type SignupMode } from '../shared/signup/signup.ts'
import { parseEmail } from './email/input.ts'

export interface Kek {
  key: Buffer
  id: number
}

export interface Config {
  production: boolean
  databaseUrl: string | null
  kek: Kek | null
  kekPrevious: Kek | null
  appOrigin: string
  cookieSecure: boolean
  anthropicApiBase: string
  openAiApiBase: string
  elevenLabsApiBase: string
  openLibraryBase: string
  openLibraryCoversBase: string
  openLibraryContact: string | null
  wiktionaryBase: string
  wikipediaBase: string
  wikimediaContact: string | null
  githubApiBase: string
  githubRawBase: string
  githubToken: string | null
  mail: MailConfig | null
  mailWebhookKey: Buffer | null
  signup: SignupMode
  siteContact: SiteContact | null
  voicesDir: string
  audiobooksDir: string | null
  billing: BillingConfig | null
  articleTestHosts: string[]
}

export type PaddleEnv = 'sandbox' | 'production'

export interface BillingConfig {
  env: PaddleEnv
  apiBase: string
  apiKey: string
  webhookSecret: string
  clientToken: string
  prices: { monthly: string; yearly: string; founding: string }
}

export interface SiteContact {
  kind: 'email' | 'url'
  value: string
}

export type MailConfig =
  | { transport: 'resend'; from: string; apiKey: string; apiBase: string }
  | { transport: 'capture'; from: string; dir: string }

export class ConfigError extends Error {
  name = 'ConfigError'
}

type Env = Record<string, string | undefined>
type ReadFile = (path: string) => string | null

export function kekId(key: Buffer): number {
  return createHash('sha256').update('agentic-library:kek-id:').update(key).digest().readInt16BE(0)
}

function parseKek(value: string | null | undefined, name: string): Kek | null {
  const text = value?.trim()
  if (!text) return null
  const key = Buffer.from(text, 'base64')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || key.length !== 32)
    throw new ConfigError(`${name} must be base64 for exactly 32 bytes (generate one with: openssl rand -base64 32)`)
  return { key, id: kekId(key) }
}

function parseOrigin(value: string, name: string): string {
  const url = URL.parse(value)
  if (!url) throw new ConfigError(`${name} must be an origin such as https://agenticlibrary.app, got "${value}"`)
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== value.replace(/\/$/, ''))
    throw new ConfigError(`${name} must be an origin such as https://agenticlibrary.app (no path), got "${value}"`)
  return url.origin
}

function parseBase(value: string | undefined, fallback: string, name: string): string {
  const text = (value?.trim() || fallback).replace(/\/+$/, '')
  const protocol = URL.parse(text)?.protocol
  if (protocol !== 'https:' && protocol !== 'http:')
    throw new ConfigError(`${name} must be an http: or https: URL, got "${value}"`)
  return text
}

function requireLocalhost(appOrigin: string, what: string): void {
  const host = new URL(appOrigin).hostname
  if (host !== 'localhost' && host !== '127.0.0.1')
    throw new ConfigError(`${what} only runs on localhost or 127.0.0.1, not ${host}`)
}

const hasControlCharacter = (text: string) =>
  [...text].some((c) => (c.codePointAt(0) ?? 0) < 0x20 || c.codePointAt(0) === 0x7f)

function parseContact(value: string | undefined, name: string): string | null {
  const text = value?.trim()
  if (!text) return null
  if (text.length > 100 || hasControlCharacter(text) || /[();]/.test(text))
    throw new ConfigError(`${name} must be at most 100 characters, without control characters, ( ) or ;`)
  return text
}

function parseWikipediaBase(value: string | undefined): string {
  const text = value?.trim() || 'https://{lang}.wikipedia.org'
  if (text.split('{lang}').length !== 2)
    throw new ConfigError(
      `WIKIPEDIA_BASE must contain {lang} once, such as https://{lang}.wikipedia.org, got "${value}"`,
    )
  parseBase(text.replace('{lang}', 'en'), '', 'WIKIPEDIA_BASE')
  return text.replace(/\/+$/, '')
}

function parseMailFrom(value: string | undefined): string {
  const text = value?.trim() ?? ''
  const named = /^([^<>]*)<([^<>]*)>$/.exec(text)
  const name = named ? (named[1] ?? '').trim() : ''
  const address = parseEmail(named ? named[2] : text)
  if (!address || name.length > 60 || hasControlCharacter(name) || name.includes('"') || (named && !name))
    throw new ConfigError(
      `MAIL_FROM must be an address or Name <address> (a name of at most 60 characters, no quotes), got "${text}"`,
    )
  return named ? `${name} <${address}>` : address
}

function parseGitHubToken(value: string | null | undefined): string | null {
  const text = value?.trim()
  if (!text) return null
  if (!/^github_pat_[A-Za-z0-9_]{22,255}$/.test(text))
    throw new ConfigError('GITHUB_TOKEN (the github_token credential) must be a fine-grained token, github_pat_…')
  return text
}

function parseResendKey(value: string | null | undefined): string {
  const text = value?.trim()
  if (!text) throw new ConfigError('MAIL_TRANSPORT=resend needs RESEND_API_KEY (the resend_api_key credential)')
  if (!/^re_\S+$/.test(text) || text.length > 200)
    throw new ConfigError('RESEND_API_KEY must start with re_, with no whitespace, and be at most 200 characters')
  return text
}

function parseWebhookSecret(value: string | null | undefined): Buffer | null {
  const text = value?.trim()
  if (!text) return null
  const encoded = text.startsWith('whsec_') ? text.slice('whsec_'.length) : ''
  const key = Buffer.from(encoded, 'base64')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || key.length < 16)
    throw new ConfigError('RESEND_WEBHOOK_SECRET must be whsec_ followed by base64 for at least 16 bytes')
  return key
}

const PADDLE_API_BASES: Record<PaddleEnv, string> = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
}
const TOKEN_PREFIX: Record<PaddleEnv, string> = { sandbox: 'test_', production: 'live_' }
const KEY_ENV = /^pdl_(sdbx|live)_/

function parseBilling(env: Env, credential: (name: string) => string | null): BillingConfig | null {
  const values = {
    PADDLE_ENV: env.PADDLE_ENV?.trim(),
    PADDLE_CLIENT_TOKEN: env.PADDLE_CLIENT_TOKEN?.trim(),
    PADDLE_PRICE_MONTHLY: env.PADDLE_PRICE_MONTHLY?.trim(),
    PADDLE_PRICE_YEARLY: env.PADDLE_PRICE_YEARLY?.trim(),
    PADDLE_PRICE_FOUNDING: env.PADDLE_PRICE_FOUNDING?.trim(),
    'paddle_api_key (or PADDLE_API_KEY)': (credential('paddle_api_key') ?? env.PADDLE_API_KEY)?.trim(),
    'paddle_webhook_secret (or PADDLE_WEBHOOK_SECRET)': (
      credential('paddle_webhook_secret') ?? env.PADDLE_WEBHOOK_SECRET
    )?.trim(),
  }
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length === Object.keys(values).length) return null
  if (missing.length > 0) throw new ConfigError(`Billing is half set up. Missing: ${missing.join(', ')}`)
  const v = values as Record<keyof typeof values, string>

  const paddleEnv = v.PADDLE_ENV
  if (paddleEnv !== 'sandbox' && paddleEnv !== 'production')
    throw new ConfigError(`PADDLE_ENV must be sandbox or production, got "${paddleEnv}"`)
  const token = v.PADDLE_CLIENT_TOKEN
  if (!/^(test|live)_[A-Za-z0-9]{8,100}$/.test(token))
    throw new ConfigError('PADDLE_CLIENT_TOKEN must be test_ or live_ followed by letters and digits')
  if (!token.startsWith(TOKEN_PREFIX[paddleEnv]))
    throw new ConfigError(
      `PADDLE_CLIENT_TOKEN is for the other environment: ${paddleEnv} needs ${TOKEN_PREFIX[paddleEnv]}…`,
    )

  const prices = {
    monthly: v.PADDLE_PRICE_MONTHLY,
    yearly: v.PADDLE_PRICE_YEARLY,
    founding: v.PADDLE_PRICE_FOUNDING,
  }
  for (const [name, id] of Object.entries(prices))
    if (!/^pri_[a-z0-9]{4,60}$/.test(id))
      throw new ConfigError(`PADDLE_PRICE_${name.toUpperCase()} must be a Paddle price id (pri_…), got "${id}"`)
  if (new Set(Object.values(prices)).size !== 3) throw new ConfigError('The three PADDLE_PRICE_ ids must differ')

  const apiKey = v['paddle_api_key (or PADDLE_API_KEY)']
  if (/\s/.test(apiKey) || apiKey.length < 20 || apiKey.length > 200)
    throw new ConfigError('The Paddle API key must be 20–200 characters with no whitespace')
  const keyEnv = KEY_ENV.exec(apiKey)?.[1]
  if (keyEnv && (keyEnv === 'live') !== (paddleEnv === 'production'))
    throw new ConfigError(`The Paddle API key is for the other environment than PADDLE_ENV=${paddleEnv}`)
  const webhookSecret = v['paddle_webhook_secret (or PADDLE_WEBHOOK_SECRET)']
  if (/\s/.test(webhookSecret) || webhookSecret.length < 16 || webhookSecret.length > 200)
    throw new ConfigError('The Paddle webhook secret must be 16–200 characters with no whitespace')

  return {
    env: paddleEnv,
    apiBase: parseBase(env.PADDLE_API_BASE, PADDLE_API_BASES[paddleEnv], 'PADDLE_API_BASE'),
    apiKey,
    webhookSecret,
    clientToken: token,
    prices,
  }
}

function parseMail(env: Env, credential: (name: string) => string | null, appOrigin: string): MailConfig | null {
  const transport = env.MAIL_TRANSPORT?.trim()
  if (!transport) return null
  if (transport !== 'resend' && transport !== 'capture')
    throw new ConfigError(`MAIL_TRANSPORT must be resend or capture, got "${transport}"`)
  const from = parseMailFrom(env.MAIL_FROM)
  if (transport === 'capture') {
    requireLocalhost(appOrigin, 'MAIL_TRANSPORT=capture')
    return { transport, from, dir: env.MAIL_CAPTURE_DIR?.trim() || '.mail' }
  }
  return {
    transport,
    from,
    apiKey: parseResendKey(credential('resend_api_key') ?? env.RESEND_API_KEY),
    apiBase: parseBase(env.RESEND_API_BASE, 'https://api.resend.com', 'RESEND_API_BASE'),
  }
}

function parseArticleTestHosts(value: string | undefined, appOrigin: string): string[] {
  const hosts = (value ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  if (!hosts.length) return []
  requireLocalhost(appOrigin, 'ARTICLE_TEST_HOSTS')
  for (const entry of hosts)
    if (!/^[a-z0-9.-]+:\d{1,5}$/.test(entry))
      throw new ConfigError(`ARTICLE_TEST_HOSTS must be host:port pairs, such as 127.0.0.1:3100, got "${entry}"`)
  return hosts
}

function parseSignup(value: string | undefined, mail: MailConfig | null): SignupMode {
  const text = value?.trim().toLowerCase()
  if (!text) return 'invite'
  const mode = SIGNUP_MODES.find((m) => m === text)
  if (!mode) throw new ConfigError(`SIGNUP must be off, invite or open, got "${value}"`)
  if (mode === 'open' && !mail) throw new ConfigError('SIGNUP=open needs mail (set MAIL_TRANSPORT)')
  return mode
}

function parseSiteContact(value: string | undefined): SiteContact | null {
  const text = value?.trim()
  if (!text) return null
  if (text.includes('@')) {
    const email = parseEmail(text)
    if (email) return { kind: 'email', value: email }
  } else if (text.length <= 200 && /^https:\/\/\S+$/.test(text) && URL.parse(text)?.protocol === 'https:') {
    return { kind: 'url', value: text }
  }
  throw new ConfigError('SITE_CONTACT must be an email address or an https:// URL of at most 200 characters')
}

export function parseConfig(env: Env, readFile: ReadFile = readOptionalFile): Config {
  const production = env.NODE_ENV === 'production'
  const credential = (name: string) =>
    env.CREDENTIALS_DIRECTORY ? readFile(join(env.CREDENTIALS_DIRECTORY, name)) : null

  const databaseUrl = env.DATABASE_URL?.trim() || null
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl))
    throw new ConfigError('DATABASE_URL must start with postgres://')
  const kek = parseKek(credential('kek') ?? env.KEK, 'KEK')
  const kekPrevious = parseKek(credential('kek_previous') ?? env.KEK_PREVIOUS, 'KEK_PREVIOUS')
  if (kek && kekPrevious && kek.id === kekPrevious.id) throw new ConfigError('KEK_PREVIOUS is the same key as KEK')

  const cookieSecureRaw = env.COOKIE_SECURE?.trim().toLowerCase()
  if (cookieSecureRaw && cookieSecureRaw !== 'true' && cookieSecureRaw !== 'false')
    throw new ConfigError(`COOKIE_SECURE must be true or false, got "${env.COOKIE_SECURE}"`)

  if (production) {
    const missing = [
      !databaseUrl && 'DATABASE_URL',
      !kek && 'KEK (the kek credential or the KEK variable)',
      !env.APP_ORIGIN && 'APP_ORIGIN',
    ].filter(Boolean)
    if (missing.length > 0) throw new ConfigError(`Missing configuration: ${missing.join(', ')}`)
  }

  const appOrigin = parseOrigin(env.APP_ORIGIN?.trim() || `http://localhost:${env.PORT ?? 3000}`, 'APP_ORIGIN')
  const mail = parseMail(env, credential, appOrigin)
  const signup = parseSignup(env.SIGNUP, mail)
  const siteContact = parseSiteContact(env.SITE_CONTACT)
  if (production && signup === 'open' && !siteContact)
    throw new ConfigError('SIGNUP=open needs SITE_CONTACT for the privacy page')
  return {
    production,
    databaseUrl,
    kek,
    kekPrevious,
    appOrigin,
    cookieSecure: cookieSecureRaw !== 'false',
    anthropicApiBase: (env.ANTHROPIC_API_BASE?.trim() || 'https://api.anthropic.com').replace(/\/+$/, ''),
    openAiApiBase: parseBase(env.OPENAI_API_BASE, 'https://api.openai.com', 'OPENAI_API_BASE'),
    elevenLabsApiBase: parseBase(env.ELEVENLABS_API_BASE, 'https://api.elevenlabs.io', 'ELEVENLABS_API_BASE'),
    openLibraryBase: parseBase(env.OPEN_LIBRARY_BASE, 'https://openlibrary.org', 'OPEN_LIBRARY_BASE'),
    openLibraryCoversBase: parseBase(
      env.OPEN_LIBRARY_COVERS_BASE,
      'https://covers.openlibrary.org',
      'OPEN_LIBRARY_COVERS_BASE',
    ),
    openLibraryContact: parseContact(env.OPEN_LIBRARY_CONTACT, 'OPEN_LIBRARY_CONTACT'),
    wiktionaryBase: parseBase(env.WIKTIONARY_BASE, 'https://en.wiktionary.org', 'WIKTIONARY_BASE'),
    wikipediaBase: parseWikipediaBase(env.WIKIPEDIA_BASE),
    wikimediaContact: parseContact(env.WIKIMEDIA_CONTACT, 'WIKIMEDIA_CONTACT'),
    githubApiBase: parseBase(env.GITHUB_API_BASE, 'https://api.github.com', 'GITHUB_API_BASE'),
    githubRawBase: parseBase(env.GITHUB_RAW_BASE, 'https://raw.githubusercontent.com', 'GITHUB_RAW_BASE'),
    githubToken: parseGitHubToken(credential('github_token') ?? env.GITHUB_TOKEN),
    mail,
    mailWebhookKey: parseWebhookSecret(credential('resend_webhook_secret') ?? env.RESEND_WEBHOOK_SECRET),
    signup,
    siteContact,
    voicesDir: voicesDirOf(env),
    audiobooksDir: parseAudiobooksDir(env.AUDIOBOOKS_DIR),
    billing: parseBilling(env, credential),
    articleTestHosts: parseArticleTestHosts(env.ARTICLE_TEST_HOSTS, appOrigin),
  }
}

function parseAudiobooksDir(value: string | undefined): string | null {
  const text = value?.trim()
  if (!text) return null
  if (!isAbsolute(text)) throw new ConfigError(`AUDIOBOOKS_DIR must be an absolute path, got "${text}"`)
  return resolve(text)
}

export const voicesDirOf = (env: Env) => resolve(env.VOICES_DIR?.trim() || '.cache/voices')

function readOptionalFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

let cached: Config | undefined

export function getConfig(): Config {
  cached ??= parseConfig(process.env)
  return cached
}
