const CACHE = 'folio-offline-v2'
const BOOKS = 'folio-books-v1'
const REPOS = 'folio-repos-v1'
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

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const REPO_PAGE = new RegExp(`^/account/repos/(${UUID})/?$`)
const REPO_PICTURE = new RegExp(`^/account/repos/(${UUID})/raw$`)
const REPO_LIST = /^\/account\/repos\/?$/
const REPO_COPY = new RegExp(`^/offline-repos/${UUID}\\.json$`)

/**
 * A picture of a downloaded repository, from the commit its copy is at: each commit's pictures sit under a prefix of
 * their own, as `repoPictureUrl` in src/shared/offline/repo.ts names them, so the copy's entry says which to use.
 */
async function keptPicture(url) {
  const id = REPO_PICTURE.exec(url.pathname)?.[1]
  const path = url.searchParams.get('path')
  if (!id || !path || !(await caches.has(REPOS))) return null
  const repos = await caches.open(REPOS)
  const entry = await repos.match(`/offline-repos/${id}.json`)
  let commit = null
  try {
    commit = JSON.parse(decodeURIComponent(entry?.headers.get('x-folio-repo') ?? '')).commit
  } catch {
    return null
  }
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) return null
  return (await repos.match(`/offline-repos/${id}/${commit}/raw/${encodeURIComponent(path)}`)) || null
}

/**
 * The key of the download a page opens from: a book's copy, or a repository's, or null for any other page. The list
 * of repositories opens from any repository's copy, so its key is null.
 */
function downloadFor(url) {
  const slug = /^\/read\/([^/]+)\//.exec(url.pathname)?.[1]
  if (slug) return { cache: BOOKS, key: `/offline/${slug}.json` }
  const repo = REPO_PAGE.exec(url.pathname)?.[1]
  if (repo) return { cache: REPOS, key: `/offline-repos/${repo}.json` }
  if (REPO_LIST.test(url.pathname)) return { cache: REPOS, key: null }
  return null
}

async function shellFor(url) {
  const download = downloadFor(url)
  if (!download || !(await caches.has(download.cache))) return null
  const kept = await caches.open(download.cache)
  const found = download.key
    ? await kept.match(download.key)
    : (await kept.keys()).some((request) => REPO_COPY.test(new URL(request.url).pathname))
  if (!found) return null
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

  if (REPO_PICTURE.test(url.pathname)) {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request)
        } catch (error) {
          const kept = await keptPicture(url)
          if (kept) return kept
          throw error
        }
      })(),
    )
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
