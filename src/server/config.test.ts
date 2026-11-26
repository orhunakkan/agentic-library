import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMITS } from '../shared/limits/limits.ts'
import { ConfigError, kekId, parseConfig } from './config'

const KEK = Buffer.alloc(32, 7).toString('base64')
const KEK2 = Buffer.alloc(32, 9).toString('base64')
const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://agentic_prod@/agentic_prod?host=/var/run/postgresql',
  KEK,
  APP_ORIGIN: 'https://agenticlibrary.app',
}
const noFiles = () => null

describe('parseConfig', () => {
  it('reads a complete production configuration', () => {
    const config = parseConfig(PROD, noFiles)
    expect(config.production).toBe(true)
    expect(config.databaseUrl).toBe(PROD.DATABASE_URL)
    expect(config.kek?.key).toHaveLength(32)
    expect(config.kek?.id).toBe(kekId(Buffer.alloc(32, 7)))
    expect(config.kekPrevious).toBeNull()
    expect(config.appOrigin).toBe('https://agenticlibrary.app')
    expect(config.cookieSecure).toBe(true)
    expect(config.anthropicApiBase).toBe('https://api.anthropic.com')
    expect(config.openAiApiBase).toBe('https://api.openai.com')
    expect(config.elevenLabsApiBase).toBe('https://api.elevenlabs.io')
  })

  it('stops production when a required value is missing', () => {
    for (const name of ['DATABASE_URL', 'KEK', 'APP_ORIGIN'] as const) {
      const env = { ...PROD, [name]: undefined }
      expect(() => parseConfig(env, noFiles), name).toThrow(ConfigError)
      expect(() => parseConfig(env, noFiles), name).toThrow(name)
    }
  })

  it('rejects malformed values', () => {
    expect(() => parseConfig({ ...PROD, KEK: Buffer.alloc(16).toString('base64') }, noFiles)).toThrow(/32 bytes/)
    expect(() => parseConfig({ ...PROD, KEK: 'not base64 at all!' }, noFiles)).toThrow(/32 bytes/)
    expect(() => parseConfig({ ...PROD, APP_ORIGIN: 'https://agenticlibrary.app/library' }, noFiles)).toThrow(/origin/)
    expect(() => parseConfig({ ...PROD, APP_ORIGIN: 'agenticlibrary.app' }, noFiles)).toThrow(/origin/)
    expect(() => parseConfig({ ...PROD, DATABASE_URL: 'mysql://x' }, noFiles)).toThrow(/postgres/)
    expect(() => parseConfig({ ...PROD, COOKIE_SECURE: 'yes' }, noFiles)).toThrow(/COOKIE_SECURE/)
    expect(() => parseConfig({ ...PROD, KEK_PREVIOUS: KEK }, noFiles)).toThrow(/same key/)
  })

  it('prefers the systemd credential over the KEK variable, and trims its newline', () => {
    const files: Record<string, string> = { '/run/creds/kek': `${KEK2}\n`, '/run/creds/kek_previous': `${KEK}\n` }
    const config = parseConfig({ ...PROD, KEK: undefined, CREDENTIALS_DIRECTORY: '/run/creds' }, (path) => {
      return files[path.replaceAll('\\', '/')] ?? null
    })
    expect(config.kek?.id).toBe(kekId(Buffer.alloc(32, 9)))
    expect(config.kekPrevious?.id).toBe(kekId(Buffer.alloc(32, 7)))
  })

  it('lets `vite dev` run without a database or KEK', () => {
    const config = parseConfig({ PORT: '3000' }, noFiles)
    expect(config.production).toBe(false)
    expect(config.databaseUrl).toBeNull()
    expect(config.kek).toBeNull()
    expect(config.appOrigin).toBe('http://localhost:3000')
  })

  it('reads the e2e settings', () => {
    const config = parseConfig(
      {
        COOKIE_SECURE: 'false',
        APP_ORIGIN: 'http://127.0.0.1:3100',
        ANTHROPIC_API_BASE: 'http://127.0.0.1:3100/test-anthropic/',
        ELEVENLABS_API_BASE: 'http://127.0.0.1:3100/test-elevenlabs//',
        OPENAI_API_BASE: 'http://127.0.0.1:3100/test-openai/',
      },
      noFiles,
    )
    expect(config.cookieSecure).toBe(false)
    expect(config.anthropicApiBase).toBe('http://127.0.0.1:3100/test-anthropic')
    expect(config.elevenLabsApiBase).toBe('http://127.0.0.1:3100/test-elevenlabs')
    expect(config.openAiApiBase).toBe('http://127.0.0.1:3100/test-openai')
    expect(() => parseConfig({ OPENAI_API_BASE: 'ftp://openai.example' }, noFiles)).toThrow(/OPENAI_API_BASE/)
    expect(() => parseConfig({ ELEVENLABS_API_BASE: 'ftp://elevenlabs.example' }, noFiles)).toThrow(
      /ELEVENLABS_API_BASE/,
    )
  })
})

describe('Open Library settings', () => {
  it('default to Open Library’s own addresses and no contact', () => {
    const config = parseConfig({}, noFiles)
    expect(config.openLibraryBase).toBe('https://openlibrary.org')
    expect(config.openLibraryCoversBase).toBe('https://covers.openlibrary.org')
    expect(config.openLibraryContact).toBeNull()
  })

  it('take an override, trailing slashes trimmed, and a contact', () => {
    const config = parseConfig(
      {
        OPEN_LIBRARY_BASE: 'http://127.0.0.1:3100/test-open-library/api/',
        OPEN_LIBRARY_COVERS_BASE: 'http://127.0.0.1:3100/test-open-library/covers//',
        OPEN_LIBRARY_CONTACT: ' owner@example.com ',
      },
      noFiles,
    )
    expect(config.openLibraryBase).toBe('http://127.0.0.1:3100/test-open-library/api')
    expect(config.openLibraryCoversBase).toBe('http://127.0.0.1:3100/test-open-library/covers')
    expect(config.openLibraryContact).toBe('owner@example.com')
  })

  it('refuse a bad base or contact', () => {
    expect(() => parseConfig({ OPEN_LIBRARY_BASE: 'ftp://example.com' }, noFiles)).toThrow(ConfigError)
    expect(() => parseConfig({ OPEN_LIBRARY_COVERS_BASE: 'not a url' }, noFiles)).toThrow(ConfigError)
    expect(() => parseConfig({ OPEN_LIBRARY_CONTACT: 'a'.repeat(101) }, noFiles)).toThrow(ConfigError)
    expect(() => parseConfig({ OPEN_LIBRARY_CONTACT: 'me; +https://evil' }, noFiles)).toThrow(ConfigError)
    expect(() => parseConfig({ OPEN_LIBRARY_CONTACT: `me${String.fromCharCode(10)}x` }, noFiles)).toThrow(ConfigError)
  })
})

describe('Wikimedia settings', () => {
  it('default to Wiktionary and Wikipedia themselves and no contact', () => {
    const config = parseConfig({}, noFiles)
    expect(config.wiktionaryBase).toBe('https://en.wiktionary.org')
    expect(config.wikipediaBase).toBe('https://{lang}.wikipedia.org')
    expect(config.wikimediaContact).toBeNull()
  })

  it('take an override, trailing slashes trimmed, and a contact', () => {
    const config = parseConfig(
      {
        WIKTIONARY_BASE: 'http://127.0.0.1:3100/test-wikimedia/wiktionary/',
        WIKIPEDIA_BASE: 'http://127.0.0.1:3100/test-wikimedia/wikipedia/{lang}/',
        WIKIMEDIA_CONTACT: 'owner@example.com',
      },
      noFiles,
    )
    expect(config.wiktionaryBase).toBe('http://127.0.0.1:3100/test-wikimedia/wiktionary')
    expect(config.wikipediaBase).toBe('http://127.0.0.1:3100/test-wikimedia/wikipedia/{lang}')
    expect(config.wikimediaContact).toBe('owner@example.com')
  })

  it('refuse a Wikipedia base without {lang} once, a bad base and a bad contact', () => {
    expect(() => parseConfig({ WIKIPEDIA_BASE: 'https://en.wikipedia.org' }, noFiles)).toThrow(/\{lang\} once/)
    expect(() => parseConfig({ WIKIPEDIA_BASE: 'https://{lang}.wikipedia.org/{lang}' }, noFiles)).toThrow(ConfigError)
    expect(() => parseConfig({ WIKIPEDIA_BASE: 'ftp://{lang}.wikipedia.org' }, noFiles)).toThrow(ConfigError)
    expect(() => parseConfig({ WIKTIONARY_BASE: 'not a url' }, noFiles)).toThrow(ConfigError)
    expect(() => parseConfig({ WIKIMEDIA_CONTACT: 'me; +https://evil' }, noFiles)).toThrow(/WIKIMEDIA_CONTACT/)
  })
})

describe('GitHub settings', () => {
  const TOKEN = `github_pat_${'A1_'.repeat(10)}`

  it('default to GitHub itself and no token', () => {
    const config = parseConfig({}, noFiles)
    expect(config.githubApiBase).toBe('https://api.github.com')
    expect(config.githubRawBase).toBe('https://raw.githubusercontent.com')
    expect(config.githubToken).toBeNull()
  })

  it('take overrides, and a token from the variable or the github_token credential first', () => {
    const config = parseConfig(
      {
        GITHUB_API_BASE: 'http://127.0.0.1:3100/test-github/api/',
        GITHUB_RAW_BASE: 'http://127.0.0.1:3100/x',
        GITHUB_TOKEN: TOKEN,
      },
      noFiles,
    )
    expect(config.githubApiBase).toBe('http://127.0.0.1:3100/test-github/api')
    expect(config.githubRawBase).toBe('http://127.0.0.1:3100/x')
    expect(config.githubToken).toBe(TOKEN)
    const fromCredential = parseConfig({ GITHUB_TOKEN: 'ignored', CREDENTIALS_DIRECTORY: '/run/creds' }, (path) =>
      path === '/run/creds/github_token' ? `${TOKEN}\n` : null,
    )
    expect(fromCredential.githubToken).toBe(TOKEN)
  })

  it('read a credential from the systemd credentials directory on disk, and treat a missing one as unset', () => {
    const dir = mkdtempSync(join(tmpdir(), 'folio-creds-'))
    try {
      writeFileSync(join(dir, 'github_token'), `${TOKEN}\n`)
      const config = parseConfig({ CREDENTIALS_DIRECTORY: dir })
      expect(config.githubToken).toBe(TOKEN)
      expect(config.kek).toBeNull()
      expect(config.mailWebhookKey).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuse a malformed token and a bad base', () => {
    expect(() => parseConfig({ GITHUB_TOKEN: 'ghp_classic0123456789012345678901' }, noFiles)).toThrow(/github_pat_/)
    expect(() => parseConfig({ GITHUB_TOKEN: 'github_pat_short' }, noFiles)).toThrow(ConfigError)
    expect(() => parseConfig({ GITHUB_API_BASE: 'ftp://x' }, noFiles)).toThrow(ConfigError)
  })
})

describe('mail settings', () => {
  const KEY = 're_test_0123456789abcdef'
  const SECRET = `whsec_${Buffer.alloc(24, 3).toString('base64')}`
  const RESEND = {
    ...PROD,
    MAIL_TRANSPORT: 'resend',
    MAIL_FROM: 'Folio <no-reply@agenticlibrary.app>',
    RESEND_API_KEY: KEY,
  }

  it('are off by default', () => {
    const config = parseConfig(PROD, noFiles)
    expect(config.mail).toBeNull()
    expect(config.mailWebhookKey).toBeNull()
  })

  it('read Resend, with the default base', () => {
    expect(parseConfig(RESEND, noFiles).mail).toEqual({
      transport: 'resend',
      from: 'Folio <no-reply@agenticlibrary.app>',
      apiKey: KEY,
      apiBase: 'https://api.resend.com',
    })
    expect(parseConfig({ ...RESEND, RESEND_API_BASE: 'http://127.0.0.1:9/resend/' }, noFiles).mail).toMatchObject({
      apiBase: 'http://127.0.0.1:9/resend',
    })
    expect(parseConfig({ ...RESEND, MAIL_FROM: ' no-reply@Agenticlibrary.app ' }, noFiles).mail?.from).toBe(
      'no-reply@agenticlibrary.app',
    )
    expect(parseConfig({ ...RESEND, MAIL_FROM: 'Folio dev  <no-reply@agenticlibrary.app>' }, noFiles).mail?.from).toBe(
      'Folio dev <no-reply@agenticlibrary.app>',
    )
  })

  it('refuse Resend without a key or MAIL_FROM, or with a malformed key', () => {
    expect(() => parseConfig({ ...RESEND, RESEND_API_KEY: undefined }, noFiles)).toThrow(/RESEND_API_KEY/)
    expect(() => parseConfig({ ...RESEND, MAIL_FROM: undefined }, noFiles)).toThrow(/MAIL_FROM/)
    expect(() => parseConfig({ ...RESEND, RESEND_API_KEY: 'sk_live_abc' }, noFiles)).toThrow(/re_/)
    expect(() => parseConfig({ ...RESEND, RESEND_API_KEY: 're_has space' }, noFiles)).toThrow(/re_/)
    expect(() => parseConfig({ ...RESEND, RESEND_API_KEY: `re_${'a'.repeat(198)}` }, noFiles)).toThrow(/200/)
    expect(() => parseConfig({ ...RESEND, MAIL_TRANSPORT: 'smtp' }, noFiles)).toThrow(/MAIL_TRANSPORT/)
  })

  it('refuse a bad MAIL_FROM', () => {
    for (const from of [
      'Folio',
      'Folio <no-reply@localhost>',
      '"Folio" <no-reply@agenticlibrary.app>',
      '<no-reply@agenticlibrary.app>',
      `${'F'.repeat(61)} <no-reply@agenticlibrary.app>`,
      'Fo\u0007lio <no-reply@agenticlibrary.app>',
      'Folio <a@b.co> <c@d.co>',
    ])
      expect(() => parseConfig({ ...RESEND, MAIL_FROM: from }, noFiles), from).toThrow(/MAIL_FROM/)
  })

  it('read capture on localhost only, with .mail by default', () => {
    const local = { MAIL_TRANSPORT: 'capture', MAIL_FROM: 'Folio <no-reply@folio.test>' }
    expect(parseConfig(local, noFiles).mail).toEqual({
      transport: 'capture',
      from: 'Folio <no-reply@folio.test>',
      dir: '.mail',
    })
    expect(
      parseConfig({ ...local, APP_ORIGIN: 'http://127.0.0.1:3100', MAIL_CAPTURE_DIR: '/tmp/mail' }, noFiles).mail,
    ).toMatchObject({ dir: '/tmp/mail' })
    expect(() => parseConfig({ ...local, APP_ORIGIN: 'https://dev.agenticlibrary.app' }, noFiles)).toThrow(/localhost/)
    expect(() => parseConfig({ ...PROD, ...local }, noFiles)).toThrow(/localhost/)
  })

  it('decode the webhook secret, and refuse one without whsec_ or too short', () => {
    expect(parseConfig({ ...RESEND, RESEND_WEBHOOK_SECRET: SECRET }, noFiles).mailWebhookKey).toEqual(
      Buffer.alloc(24, 3),
    )
    expect(() => parseConfig({ ...RESEND, RESEND_WEBHOOK_SECRET: SECRET.slice(6) }, noFiles)).toThrow(/whsec_/)
    const short = `whsec_${Buffer.alloc(15, 3).toString('base64')}`
    expect(() => parseConfig({ ...RESEND, RESEND_WEBHOOK_SECRET: short }, noFiles)).toThrow(/16 bytes/)
    expect(() => parseConfig({ ...RESEND, RESEND_WEBHOOK_SECRET: 'whsec_not base64!' }, noFiles)).toThrow(/whsec_/)
  })

  it('read the key and the secret from systemd credentials first', () => {
    const files: Record<string, string> = {
      '/run/creds/kek': `${KEK}\n`,
      '/run/creds/resend_api_key': 're_from_the_file\n',
      '/run/creds/resend_webhook_secret': `${SECRET}\n`,
    }
    const config = parseConfig(
      { ...RESEND, KEK: undefined, RESEND_API_KEY: 're_from_the_variable', CREDENTIALS_DIRECTORY: '/run/creds' },
      (path) => files[path.replaceAll('\\', '/')] ?? null,
    )
    expect(config.mail).toMatchObject({ apiKey: 're_from_the_file' })
    expect(config.mailWebhookKey).toEqual(Buffer.alloc(24, 3))
  })
})

describe('sign-up settings', () => {
  const MAIL = { MAIL_TRANSPORT: 'resend', MAIL_FROM: 'no-reply@agenticlibrary.app', RESEND_API_KEY: 're_test_key' }

  it('are invite only by default, so a deploy changes nothing', () => {
    expect(parseConfig(PROD, noFiles).signup).toBe('invite')
    expect(parseConfig({ ...PROD, SIGNUP: '  ' }, noFiles).signup).toBe('invite')
  })

  it('read off, invite and open in any case', () => {
    expect(parseConfig({ ...PROD, SIGNUP: 'off' }, noFiles).signup).toBe('off')
    expect(parseConfig({ ...PROD, SIGNUP: 'INVITE' }, noFiles).signup).toBe('invite')
    expect(parseConfig({ ...PROD, ...MAIL, SIGNUP: ' Open ', SITE_CONTACT: 'a@example.org' }, noFiles).signup).toBe(
      'open',
    )
  })

  it('refuse anything else', () => {
    expect(() => parseConfig({ ...PROD, SIGNUP: 'yes' }, noFiles)).toThrow(/SIGNUP must be off, invite or open/)
  })

  it('refuse open sign-up without mail, which mails its links', () => {
    expect(() => parseConfig({ ...PROD, SIGNUP: 'open' }, noFiles)).toThrow(/MAIL_TRANSPORT/)
  })
})

describe('the privacy contact', () => {
  const MAIL = { MAIL_TRANSPORT: 'resend', MAIL_FROM: 'no-reply@agenticlibrary.app', RESEND_API_KEY: 're_test_key' }

  it('is unset by default', () => {
    expect(parseConfig(PROD, noFiles).siteContact).toBeNull()
  })

  it('reads an address or an https: page', () => {
    expect(parseConfig({ ...PROD, SITE_CONTACT: ' Privacy@Example.ORG ' }, noFiles).siteContact).toEqual({
      kind: 'email',
      value: 'Privacy@example.org',
    })
    expect(parseConfig({ ...PROD, SITE_CONTACT: 'https://example.org/contact' }, noFiles).siteContact).toEqual({
      kind: 'url',
      value: 'https://example.org/contact',
    })
  })

  it('refuses anything else', () => {
    for (const value of [
      'http://example.org/contact',
      'javascript:alert(1)',
      `https://example.org/${'x'.repeat(181)}`,
      'not@an address',
      'https://exa mple.org',
    ])
      expect(() => parseConfig({ ...PROD, SITE_CONTACT: value }, noFiles), value).toThrow(/SITE_CONTACT must be/)
  })

  it('is needed before production opens sign-up, and only then', () => {
    expect(() => parseConfig({ ...PROD, ...MAIL, SIGNUP: 'open' }, noFiles)).toThrow(/SITE_CONTACT/)
    expect(parseConfig({ ...PROD, ...MAIL, SIGNUP: 'open', SITE_CONTACT: 'a@example.org' }, noFiles).signup).toBe(
      'open',
    )
    expect(parseConfig({ ...PROD, SIGNUP: 'invite' }, noFiles).siteContact).toBeNull()
    const dev = { APP_ORIGIN: 'http://localhost:3000', MAIL_TRANSPORT: 'capture', MAIL_FROM: 'no-reply@folio.test' }
    expect(parseConfig({ ...dev, SIGNUP: 'open' }, noFiles).signup).toBe('open')
  })
})

describe('the Folio voice’s files', () => {
  it('default to .cache/voices under the working directory', () => {
    expect(parseConfig(PROD, noFiles).voicesDir).toBe(resolve('.cache/voices'))
  })

  it('read VOICES_DIR, resolved', () => {
    expect(parseConfig({ ...PROD, VOICES_DIR: ' /opt/agentic-library/voices ' }, noFiles).voicesDir).toBe(
      '/opt/agentic-library/voices',
    )
    expect(parseConfig({ ...PROD, VOICES_DIR: 'voices' }, noFiles).voicesDir).toBe(resolve('voices'))
  })
})

describe('the audiobooks’ directory', () => {
  it('is off when AUDIOBOOKS_DIR is unset', () => {
    expect(parseConfig(PROD, noFiles).audiobooksDir).toBeNull()
    expect(parseConfig({ ...PROD, AUDIOBOOKS_DIR: ' ' }, noFiles).audiobooksDir).toBeNull()
  })

  it('takes an absolute path and refuses a relative one', () => {
    expect(
      parseConfig({ ...PROD, AUDIOBOOKS_DIR: ' /var/lib/agentic-library/dev-audiobooks/ ' }, noFiles).audiobooksDir,
    ).toBe('/var/lib/agentic-library/dev-audiobooks')
    expect(() => parseConfig({ ...PROD, AUDIOBOOKS_DIR: 'audiobooks' }, noFiles)).toThrow(/absolute path/)
  })
})

describe('leftover billing settings', () => {
  it('are ignored, so a server that still has them starts, with no billing in its config', () => {
    const files: Record<string, string> = {
      '/run/creds/paddle_api_key': 'pdl_sdbx_apikey_0123456789abcdefghij\n',
      '/run/creds/paddle_webhook_secret': 'pdl_ntfset_0123456789abcdef\n',
    }
    const leftover = {
      ...PROD,
      PADDLE_ENV: 'sandbox',
      PADDLE_CLIENT_TOKEN: 'test_0123456789abcdef',
      PADDLE_PRICE_MONTHLY: 'pri_01monthly',
      PADDLE_API_KEY: 'not even a valid key',
      CREDENTIALS_DIRECTORY: '/run/creds',
    }
    const config = parseConfig(leftover, (path) => files[path.replaceAll('\\', '/')] ?? null)
    expect(config).not.toHaveProperty('billing')
    expect(config).toEqual(parseConfig({ ...PROD, CREDENTIALS_DIRECTORY: '/run/creds' }, noFiles))
  })
})

describe('ARTICLE_TEST_HOSTS', () => {
  it('is empty unless set', () => expect(parseConfig({}, noFiles).articleTestHosts).toEqual([]))
  it('reads host:port pairs on localhost', () => {
    const config = parseConfig(
      { APP_ORIGIN: 'http://localhost:3100', ARTICLE_TEST_HOSTS: ' 127.0.0.1:3100, A.test:80 ,' },
      noFiles,
    )
    expect(config.articleTestHosts).toEqual(['127.0.0.1:3100', 'a.test:80'])
    expect(
      parseConfig({ APP_ORIGIN: 'http://127.0.0.1:3000', ARTICLE_TEST_HOSTS: 'x:1' }, noFiles).articleTestHosts,
    ).toEqual(['x:1'])
  })
  it('stops a server that isn’t on localhost, and a malformed entry', () => {
    expect(() => parseConfig({ ...PROD, ARTICLE_TEST_HOSTS: '127.0.0.1:3100' }, noFiles)).toThrow(
      /only runs on localhost/,
    )
    expect(() =>
      parseConfig({ APP_ORIGIN: 'https://dev.agenticlibrary.app', ARTICLE_TEST_HOSTS: '127.0.0.1:1' }, noFiles),
    ).toThrow(/only runs on localhost/)
    expect(() => parseConfig({ ARTICLE_TEST_HOSTS: '127.0.0.1' }, noFiles)).toThrow(/host:port/)
    expect(() => parseConfig({ ARTICLE_TEST_HOSTS: 'http://a:1' }, noFiles)).toThrow(/host:port/)
  })
})

describe('the storage limits', () => {
  const GiB = 1024 ** 3
  const MiB = 1024 ** 2

  it('are the defaults when no LIMIT_* is set, or one is empty', () => {
    expect(parseConfig({}, noFiles).limits).toEqual(DEFAULT_LIMITS)
    expect(parseConfig({ LIMIT_USER_AUDIO: '', LIMIT_BOOKS: ' ' }, noFiles).limits).toEqual(DEFAULT_LIMITS)
  })

  it('read the hosted values, in binary units', () => {
    const { limits } = parseConfig(
      { LIMIT_USER_AUDIO: '1GB', LIMIT_AUDIOBOOK_SIZE: '1GB', LIMIT_USER_PICTURES: '100MB' },
      noFiles,
    )
    expect(limits).toEqual({ ...DEFAULT_LIMITS, userAudioBytes: GiB, audiobookBytes: GiB, userPictureBytes: 100 * MiB })
  })

  it('read a unit in any case, with an optional space, and counts as whole numbers', () => {
    const { limits } = parseConfig(
      {
        LIMIT_USER_AUDIO: '1gb',
        LIMIT_AUDIOBOOK_SIZE: '512 Mb',
        LIMIT_USER_PICTURES: '100 MB',
        LIMIT_BOOKS: '1000',
        LIMIT_ARTICLES: '3',
        LIMIT_ARTICLE_TEXT: ' 64KB ',
      },
      noFiles,
    )
    expect(limits).toEqual({
      userAudioBytes: GiB,
      audiobookBytes: 512 * MiB,
      userPictureBytes: 100 * MiB,
      books: 1000,
      articles: 3,
      articleTextBytes: 64 * 1024,
    })
  })

  it('stop the server on a value that is not a size or a count, or is zero, naming the variable', () => {
    const refused: Record<string, string>[] = [
      { LIMIT_USER_AUDIO: '1' },
      { LIMIT_USER_AUDIO: '0GB' },
      { LIMIT_USER_AUDIO: '1TB' },
      { LIMIT_USER_PICTURES: '-5' },
      { LIMIT_USER_PICTURES: '1.5GB' },
      { LIMIT_ARTICLE_TEXT: 'MB' },
      { LIMIT_BOOKS: '0' },
      { LIMIT_BOOKS: 'abc' },
      { LIMIT_ARTICLES: '2.5' },
      { LIMIT_ARTICLES: '-1' },
    ]
    for (const env of refused) {
      const [name] = Object.keys(env)
      expect(() => parseConfig(env, noFiles), JSON.stringify(env)).toThrow(ConfigError)
      expect(() => parseConfig(env, noFiles), JSON.stringify(env)).toThrow(name)
    }
  })

  it('stop the server on a size above Number.MAX_SAFE_INTEGER bytes', () => {
    expect(() => parseConfig({ LIMIT_USER_AUDIO: '9999999GB' }, noFiles)).toThrow(/LIMIT_USER_AUDIO/)
  })

  it('stop the server when one audiobook may be larger than all of a reader’s audio', () => {
    expect(() => parseConfig({ LIMIT_AUDIOBOOK_SIZE: '9GB' }, noFiles)).toThrow(/LIMIT_AUDIOBOOK_SIZE/)
    expect(() => parseConfig({ LIMIT_USER_AUDIO: '1GB' }, noFiles)).toThrow(/LIMIT_AUDIOBOOK_SIZE/)
    expect(parseConfig({ LIMIT_USER_AUDIO: '2GB' }, noFiles).limits.audiobookBytes).toBe(2 * GiB)
  })

  it('stop the server when an article may hold more text than the 8 MB a book can', () => {
    expect(() => parseConfig({ LIMIT_ARTICLE_TEXT: '9MB' }, noFiles)).toThrow(/LIMIT_ARTICLE_TEXT/)
    expect(parseConfig({ LIMIT_ARTICLE_TEXT: '8MB' }, noFiles).limits.articleTextBytes).toBe(8 * MiB)
  })
})
