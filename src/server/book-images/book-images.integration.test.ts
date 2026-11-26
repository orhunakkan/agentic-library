import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, vi } from 'vitest'
import { it, raw } from '../testing/db-test'
import { testUser } from '../testing/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { handleChapter, handleFinish, handleNewBook } from '~/server/book-actions'
import { handleImage, serveImage } from '~/server/book-images/actions'
import {
  imageBytesUsed,
  imageSizes,
  loadImage,
  type NewImage,
  newImage,
  storedImageCount,
  storeImage,
} from '~/server/book-images/store'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { deleteBook, finishImport, loadBookPage, startImport, storeChapter } from '~/server/user-books'
import { NO_DETAILS } from '~/shared/import/details'
import { sniffImage } from '~/shared/import/image'
import { MAX_IMAGE_BYTES } from '~/shared/import/limits'
import { DEFAULT_LIMITS } from '~/shared/limits/limits'

const db = () => getDb()

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/images/${name}`, import.meta.url)))
const picture = (name: string): NewImage => {
  const bytes = fixture(name)
  const info = sniffImage(bytes)
  if (!info || (info.type !== 'image/jpeg' && info.type !== 'image/png')) throw new Error(`${name} is not JPEG or PNG`)
  return newImage(bytes, { ...info, type: info.type })
}
const sized = (size: number): NewImage => newImage(new Uint8Array(size), { type: 'image/png', width: 10, height: 10 })

const META = { title: 'Figures', author: 'Ada', language: 'en', details: NO_DETAILS, chapterCount: 1 }

afterAll(async () => {
  await closeDb()
})

const newUser = (username: string) => testUser(db(), username, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')

async function uploading(userId: number, count = 3, bytes = 3 * MAX_IMAGE_BYTES) {
  const start = await startImport(db(), userId, { ...META, images: { count, bytes } }, new Date(), DEFAULT_LIMITS)
  if (!start.ok) throw new Error(`could not start: ${start.reason}`)
  return start.id
}

async function finish(userId: number, bookId: string) {
  expect(await storeChapter(db(), userId, bookId, 0, { title: 'Morning', pages: ['<p>one</p>'] }, DEFAULT_LIMITS)).toBe(
    'ok',
  )
  return finishImport(db(), userId, bookId, null)
}

describe('the store', () => {
  it('stores a picture, replaces it when sent again, and serves it once the book is ready', async () => {
    const user = await newUser('reader')
    const bookId = await uploading(user.id, 1)
    expect(await storeImage(db(), user.id, bookId, 1, picture('cover.jpg'), DEFAULT_LIMITS)).toBe('ok')
    expect(await storeImage(db(), user.id, bookId, 1, picture('wide.png'), DEFAULT_LIMITS)).toBe('ok')
    expect(await storedImageCount(db(), user.id, bookId)).toBe(1)
    expect(await imageSizes(db(), user.id, bookId)).toEqual(new Map([[1, { width: 900, height: 600 }]]))
    expect(await loadImage(db(), user.id, bookId, 1)).toBeNull()
    expect(await finish(user.id, bookId)).toBe('ok')
    const loaded = await loadImage(db(), user.id, bookId, 1)
    expect(loaded).toEqual({ mediaType: 'image/png', bytes: fixture('wide.png'), sha256: picture('wide.png').sha256 })
    expect(await loadImage(db(), user.id, bookId, 2)).toBeNull()
  })

  it('finds no book of another user, no ready book and no unknown id', async () => {
    const owner = await newUser('owner')
    const other = await newUser('other')
    const bookId = await uploading(owner.id, 1)
    expect(await storeImage(db(), other.id, bookId, 1, picture('cover.jpg'), DEFAULT_LIMITS)).toBe('missing')
    expect(
      await storeImage(db(), owner.id, '00000000-0000-4000-8000-000000000000', 1, picture('cover.jpg'), DEFAULT_LIMITS),
    ).toBe('missing')
    expect(await storeImage(db(), owner.id, bookId, 1, picture('cover.jpg'), DEFAULT_LIMITS)).toBe('ok')
    expect(await imageSizes(db(), other.id, bookId)).toEqual(new Map())
    expect(await storedImageCount(db(), other.id, bookId)).toBe(0)
    expect(await finish(owner.id, bookId)).toBe('ok')
    expect(await loadImage(db(), other.id, bookId, 1)).toBeNull()
    expect(await storeImage(db(), owner.id, bookId, 1, picture('wide.png'), DEFAULT_LIMITS)).toBe('missing')
  })

  it('refuses a number past the declared count', async () => {
    const user = await newUser('reader')
    const bookId = await uploading(user.id, 2)
    expect(await storeImage(db(), user.id, bookId, 3, picture('cover.jpg'), DEFAULT_LIMITS)).toBe('position')
    const none = await uploading(user.id, 0, 0)
    expect(await storeImage(db(), user.id, none, 1, picture('cover.jpg'), DEFAULT_LIMITS)).toBe('position')
  })

  it('keeps a book within the bytes it declared, counting a replaced picture once', async () => {
    const user = await newUser('reader')
    const bookId = await uploading(user.id, 2, 1000)
    expect(await storeImage(db(), user.id, bookId, 1, sized(600), DEFAULT_LIMITS)).toBe('ok')
    expect(await storeImage(db(), user.id, bookId, 2, sized(401), DEFAULT_LIMITS)).toEqual({ quota: 'book', max: 1000 })
    expect(await storeImage(db(), user.id, bookId, 2, sized(400), DEFAULT_LIMITS)).toBe('ok')
    expect(await storeImage(db(), user.id, bookId, 1, sized(600), DEFAULT_LIMITS)).toBe('ok')
  })

  it('keeps the account within the picture limit it is given, across its books', async () => {
    const limits = { ...DEFAULT_LIMITS, userPictureBytes: 5000 }
    const user = await newUser('reader')
    const full = await uploading(user.id, 1, 3000)
    expect(await storeImage(db(), user.id, full, 1, sized(3000), limits)).toBe('ok')
    const left = 2000
    expect(await imageBytesUsed(db(), user.id)).toBe(3000)
    expect(
      await startImport(db(), user.id, { ...META, images: { count: 1, bytes: left + 1 } }, new Date(), limits),
    ).toEqual({ ok: false, reason: 'room', max: 5000 })
    const first = await startImport(db(), user.id, { ...META, images: { count: 2, bytes: left } }, new Date(), limits)
    const second = await startImport(db(), user.id, { ...META, images: { count: 1, bytes: 100 } }, new Date(), limits)
    expect(first).toMatchObject({ ok: true, imageBytesLeft: 0 })
    if (!first.ok || !second.ok) throw new Error('could not start')
    expect(await storeImage(db(), user.id, first.id, 1, sized(left - 10), limits)).toBe('ok')
    expect(await storeImage(db(), user.id, second.id, 1, sized(11), limits)).toEqual({ quota: 'user', max: 5000 })
    expect(await storeImage(db(), user.id, first.id, 2, sized(10), limits)).toBe('ok')
  })

  it('needs every declared picture before the book is finished', async () => {
    const user = await newUser('reader')
    const bookId = await uploading(user.id, 2)
    expect(await storeImage(db(), user.id, bookId, 1, picture('cover.jpg'), DEFAULT_LIMITS)).toBe('ok')
    expect(await finish(user.id, bookId)).toBe('incomplete')
    expect(await storeImage(db(), user.id, bookId, 2, picture('wide.png'), DEFAULT_LIMITS)).toBe('ok')
    expect(await finishImport(db(), user.id, bookId, null)).toBe('ok')
  })

  it('deletes the pictures with the book and with the user', async () => {
    const user = await newUser('reader')
    const first = await uploading(user.id, 1)
    const second = await uploading(user.id, 1)
    expect(await storeImage(db(), user.id, first, 1, picture('cover.jpg'), DEFAULT_LIMITS)).toBe('ok')
    expect(await storeImage(db(), user.id, second, 1, picture('cover.jpg'), DEFAULT_LIMITS)).toBe('ok')
    expect(await deleteBook(db(), user.id, first)).toBe(true)
    const count = async () => Number((await raw<{ n: string }[]>`select count(*) as n from user_book_images`)[0]?.n)
    expect(await count()).toBe(1)
    await raw`delete from users where id = ${user.id}`
    expect(await count()).toBe(0)
  })
})

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'

async function signIn(userId: number) {
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId, ip: null, userAgent: 'test' })
  return `${cookieName}=${token}`
}

const json = (cookie: string | null, body: unknown, extra = {}) =>
  new Request(`${origin}/account/books/new`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...extra },
    body: JSON.stringify(body),
  })

const upload = (cookie: string | null, id: string, n: string, bytes: Uint8Array, type = 'image/png', extra = {}) =>
  handleImage(
    new Request(`${origin}/account/books/${id}/images/${n}`, {
      method: 'POST',
      headers: { origin, ...(type ? { 'content-type': type } : {}), ...(cookie ? { cookie } : {}), ...extra },
      body: new Uint8Array(bytes),
    }),
    id,
    n,
  )

const fetchImage = (cookie: string | null, id: string, n: string) =>
  serveImage(new Request(`${origin}/account/books/${id}/images/${n}`, { headers: cookie ? { cookie } : {} }), id, n)

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

const BOOK = { title: 'Figures', author: 'Ada', language: 'en', chapterCount: 1 }
const figure = (image: number) => ({
  title: 'Morning',
  blocks: [
    { type: 'paragraph', runs: [{ text: 'Text.' }] },
    { type: 'image', image, alt: 'A "map"' },
  ],
})

async function started(username: string, count = 2, bytes = 2 * MAX_IMAGE_BYTES) {
  const user = await newUser(username)
  const cookie = await signIn(user.id)
  const res = await handleNewBook(json(cookie, { ...BOOK, images: { count, bytes } }))
  expect(res.status).toBe(201)
  const { id } = (await res.json()) as { id: string }
  return { user, cookie, id }
}

describe('starting an import with pictures', () => {
  it('stores the declared count and bytes, and answers the room left', async () => {
    const user = await newUser('reader')
    const cookie = await signIn(user.id)
    const res = await handleNewBook(json(cookie, { ...BOOK, images: { count: 3, bytes: 1000 } }))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; imageBytesLeft: number }
    expect(body.imageBytesLeft).toBe(getConfig().limits.userPictureBytes - 1000)
    const [row] = await raw<{ image_count: number; image_bytes: number }[]>`
      select image_count, image_bytes from user_books where id = ${body.id}`
    expect(row).toEqual({ image_count: 3, image_bytes: 1000 })
    const plain = (await (await handleNewBook(json(cookie, BOOK))).json()) as { id: string; imageBytesLeft: number }
    expect(plain.imageBytesLeft).toBe(getConfig().limits.userPictureBytes)
  })

  it('refuses more than 500 pictures or 30 MB, and more than the account has left', async () => {
    const user = await newUser('reader')
    const cookie = await signIn(user.id)
    for (const images of [
      { count: 501, bytes: 501 },
      { count: 40, bytes: 30 * 1024 * 1024 + 1 },
    ]) {
      const res = await handleNewBook(json(cookie, { ...BOOK, images }))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid' })
    }
    const full = await startImport(
      db(),
      user.id,
      { ...BOOK, details: NO_DETAILS, images: { count: 300, bytes: 1 } },
      new Date(),
      DEFAULT_LIMITS,
    )
    if (!full.ok) throw new Error('could not start')
    await raw`
      insert into user_book_images (book_id, n, media_type, bytes, width, height, sha256)
      select ${full.id}, g, 'image/png', decode(repeat('00', ${MAX_IMAGE_BYTES}), 'hex'), 1, 1, repeat('a', 64)
      from generate_series(1, 284) g`
    const left = getConfig().limits.userPictureBytes - 284 * MAX_IMAGE_BYTES
    const res = await handleNewBook(json(cookie, { ...BOOK, images: { count: 1, bytes: left + 1 } }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'quota', scope: 'user', max: getConfig().limits.userPictureBytes })
  })
})

describe('POST /account/books/<id>/images/<n>', () => {
  it('stores a picture this tab drew and answers its size', async () => {
    const { cookie, id, user } = await started('reader')
    const res = await upload(cookie, id, '1', fixture('wide.png'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ ok: true, width: 900, height: 600 })
    expect((await upload(cookie, id, '2', fixture('cover.jpg'), 'image/jpeg')).status).toBe(200)
    expect(await imageSizes(db(), user.id, id)).toEqual(
      new Map([
        [1, { width: 900, height: 600 }],
        [2, { width: 400, height: 600 }],
      ]),
    )
  })

  it('is a 404 signed out, for another user’s book and for a bad id or number', async () => {
    const { cookie, id } = await started('reader')
    const other = await signIn((await newUser('other')).id)
    const png = fixture('wide.png')
    expect((await upload(null, id, '1', png)).status).toBe(404)
    expect((await upload(other, id, '1', png)).status).toBe(404)
    expect((await upload(cookie, 'not-a-uuid', '1', png)).status).toBe(404)
    for (const n of ['0', '501', '01', 'x']) expect((await upload(cookie, id, n, png)).status, n).toBe(404)
  })

  it.each([
    ['a GIF', () => fixture('wide.png'), 'image/gif', 415, 'invalid'],
    ['no type', () => fixture('wide.png'), '', 415, 'invalid'],
    ['a JPEG sent as a PNG', () => fixture('cover.jpg'), 'image/png', 400, 'invalid'],
    ['bytes that are no picture', () => fixture('not-an-image.jpg'), 'image/jpeg', 400, 'invalid'],
    ['a PNG 1,601 wide', () => pngHeader(1601, 100), 'image/png', 400, 'invalid'],
    ['a PNG 15 px tall', () => pngHeader(100, 15), 'image/png', 400, 'invalid'],
  ])('refuses %s', async (_, bytes, type, status, error) => {
    const { cookie, id } = await started('reader')
    const res = await upload(cookie, id, '1', bytes(), type)
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error })
  })

  it('refuses an empty body', async () => {
    const { cookie, id } = await started('reader')
    const res = await upload(cookie, id, '1', new Uint8Array())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid' })
  })

  it('answers 500 when the database fails, and logs it', async () => {
    const { cookie, id } = await started('reader')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
      const res = await upload(cookie, id, '1', fixture('wide.png'))
      expect([res.status, await res.json()]).toEqual([500, { error: 'failed' }])
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringMatching(/^\[book picture upload\] /),
      ])
    } finally {
      errors.mockRestore()
    }
  })

  it('refuses a number past the declared count, and a picture past the book’s declared bytes', async () => {
    const { cookie, id } = await started('reader', 2, 7000)
    expect((await upload(cookie, id, '3', fixture('cover.jpg'), 'image/jpeg')).status).toBe(400)
    expect((await upload(cookie, id, '1', fixture('cover.jpg'), 'image/jpeg')).status).toBe(200)
    const res = await upload(cookie, id, '2', fixture('wide.png'))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'quota', scope: 'book', max: 7000 })
  })
})

describe('chapters and finishing with pictures', () => {
  const chapter = (cookie: string | null, id: string, body: unknown) =>
    handleChapter(
      new Request(`${origin}/account/books/${id}/chapters/0`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      }),
      id,
      '0',
    )
  const finish = (cookie: string, id: string) =>
    handleFinish(
      new Request(`${origin}/account/books/${id}/finish`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', cookie },
        body: '{}',
      }),
      id,
    )

  it('refuses a chapter that shows a picture not stored, and renders one that is with the server’s size', async () => {
    const { cookie, id, user } = await started('reader', 1, MAX_IMAGE_BYTES)
    expect((await chapter(cookie, id, figure(1))).status).toBe(400)
    expect((await upload(cookie, id, '1', fixture('wide.png'))).status).toBe(200)
    expect((await chapter(cookie, id, figure(1))).status).toBe(200)
    const [stored] = await raw<{ pages: string[] }[]>`select pages from user_book_chapters where book_id = ${id}`
    expect(stored?.pages.join('')).toContain(
      `<figure><a href="/account/books/${id}/images/1"><img src="/account/books/${id}/images/1" ` +
        'alt="A &quot;map&quot;" width="900" height="600" loading="lazy" decoding="async"></a></figure>',
    )
    const other = await started('other', 0, 0)
    expect((await chapter(other.cookie, other.id, figure(1))).status).toBe(400)
    expect(await storedImageCount(db(), user.id, id)).toBe(1)
  })

  it('keeps a caption whose picture was left out', async () => {
    const { cookie, id } = await started('reader', 0, 0)
    const body = { title: 'T', blocks: [{ type: 'image', image: 0, alt: '', caption: [{ text: 'Figure 2' }] }] }
    expect((await chapter(cookie, id, body)).status).toBe(200)
    const [stored] = await raw<{ pages: string[] }[]>`select pages from user_book_chapters where book_id = ${id}`
    expect(stored?.pages).toEqual(['<figure><figcaption>Figure 2</figcaption></figure>'])
  })

  it('finishes only once every declared picture is stored', async () => {
    const { cookie, id, user } = await started('reader', 2)
    expect((await upload(cookie, id, '1', fixture('wide.png'))).status).toBe(200)
    expect((await chapter(cookie, id, figure(1))).status).toBe(200)
    const res = await finish(cookie, id)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'incomplete' })
    expect((await upload(cookie, id, '2', fixture('cover.jpg'), 'image/jpeg')).status).toBe(200)
    expect((await finish(cookie, id)).status).toBe(200)
    expect((await loadBookPage(db(), user.id, id))?.imageCount).toBe(2)
  })
})

describe('GET /account/books/<id>/images/<n>', () => {
  it('serves the owner’s ready book’s picture with its type, never cached', async () => {
    const { cookie, id, user } = await started('reader', 1, MAX_IMAGE_BYTES)
    expect((await upload(cookie, id, '1', fixture('wide.png'))).status).toBe(200)
    expect((await fetchImage(cookie, id, '1')).status).toBe(404)
    expect(await finishWithChapter(user.id, id)).toBe('ok')
    const res = await fetchImage(cookie, id, '1')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('etag')).toBe(`"${picture('wide.png').sha256}"`)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(fixture('wide.png'))
  })

  it('answers 503 when the database fails, and logs it', async () => {
    const { cookie, id, user } = await started('reader', 1, MAX_IMAGE_BYTES)
    expect((await upload(cookie, id, '1', fixture('wide.png'))).status).toBe(200)
    expect(await finishWithChapter(user.id, id)).toBe('ok')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
      const res = await fetchImage(cookie, id, '1')
      expect([res.status, res.headers.get('cache-control')]).toEqual([503, 'private, no-store'])
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([
        expect.stringMatching(/^\[book picture read\] /),
      ])
    } finally {
      errors.mockRestore()
    }
  })

  it('is a 404 signed out, for another user, a missing number and a bad address', async () => {
    const { cookie, id, user } = await started('reader', 1, MAX_IMAGE_BYTES)
    expect((await upload(cookie, id, '1', fixture('wide.png'))).status).toBe(200)
    expect(await finishWithChapter(user.id, id)).toBe('ok')
    const other = await signIn((await newUser('other')).id)
    for (const [who, book, n] of [
      [null, id, '1'],
      [other, id, '1'],
      [cookie, id, '2'],
      [cookie, id, 'x'],
      [cookie, 'not-a-uuid', '1'],
    ] as const) {
      const res = await fetchImage(who, book, n)
      expect(res.status, `${who ? 'signed in' : 'signed out'} ${book} ${n}`).toBe(404)
      expect(res.headers.get('cache-control')).toBe('private, no-store')
    }
  })
})

const broken = (() => {
  throw new Error('the database went away')
}) as unknown as Pool

async function finishWithChapter(userId: number, bookId: string) {
  await storeChapter(db(), userId, bookId, 0, { title: 'Morning', pages: ['<p>one</p>'] }, DEFAULT_LIMITS)
  return finishImport(db(), userId, bookId, null)
}
