const CACHE = 'folio-offline-v2'
const BOOKS = 'folio-books-v1'
const OFFLINE_URL = '/offline.html'
const SHELL_URL = '/_shell.html'

const BOOK_FILE = /^\/(images\/|covers\/|offline\/|account\/books\/[0-9a-f-]{36}\/(images\/\d+|cover)$)/

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k.startsWith('folio-offline-') && k !== CACHE).map((k) => caches.delete(k)))
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      await self.clients.claim()
    })(),
  )
})

async function shellFor(url) {
  const slug = /^\/read\/([^/]+)\//.exec(url.pathname)?.[1]
  if (!slug || !(await caches.has(BOOKS))) return null
  const books = await caches.open(BOOKS)
  if (!(await books.match(`/offline/${slug}.json`))) return null
  return (await caches.match(SHELL_URL)) || null
}

async function signInPrompt(response) {
  if (!(await self.registration.unregister())) return response
  return new Response('<!doctype html><meta http-equiv="refresh" content="0"><title>Folio</title>', {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = (await event.preloadResponse) || (await fetch(request))
          if (response.status === 401 && response.headers.has('www-authenticate')) return await signInPrompt(response)
          return response
        } catch {
          return (await shellFor(url)) || (await caches.match(OFFLINE_URL)) || Response.error()
        }
      })(),
    )
    return
  }

  if (url.origin !== self.location.origin || request.headers.has('range')) return

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => (await caches.match(request)) || fetch(request))())
    return
  }

  if (BOOK_FILE.test(url.pathname)) {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request)
        } catch (error) {
          const books = (await caches.has(BOOKS)) ? await caches.open(BOOKS) : null
          const kept = books && (await books.match(request))
          if (kept) return kept
          throw error
        }
      })(),
    )
  }
})
