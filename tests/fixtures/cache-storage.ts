const BASE = 'http://localhost'

const urlOf = (request: RequestInfo | URL) =>
  new URL(typeof request === 'string' || request instanceof URL ? request : request.url, BASE).href

export class FakeCache {
  readonly entries = new Map<string, Response>()
  constructor(private readonly fetcher: (url: string) => Promise<Response>) {}

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(urlOf(request))?.clone()
  }
  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(urlOf(request), response.clone())
  }
  async add(request: RequestInfo | URL): Promise<void> {
    const url = urlOf(request)
    const response = await this.fetcher(url)
    if (!response.ok) throw new TypeError(`Request failed: ${response.status}`)
    this.entries.set(url, response)
  }
  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(urlOf(request))
  }
  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url))
  }
  paths(): string[] {
    return [...this.entries.keys()].map((url) => new URL(url).pathname + new URL(url).search).sort()
  }
}

export class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>()
  fetcher: (url: string) => Promise<Response> = async () => new Response('', { status: 404 })

  async open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name)
    if (!cache) {
      cache = new FakeCache((url) => this.fetcher(url))
      this.caches.set(name, cache)
    }
    return cache
  }
  async has(name: string): Promise<boolean> {
    return this.caches.has(name)
  }
  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name)
  }
  async keys(): Promise<string[]> {
    return [...this.caches.keys()]
  }
  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    for (const cache of this.caches.values()) {
      const found = await cache.match(request)
      if (found) return found
    }
    return undefined
  }
  get api(): CacheStorage {
    return this as unknown as CacheStorage
  }
}

export function memoryStorage(blocked = false): Storage {
  const map = new Map<string, string>()
  const guard = () => {
    if (blocked) throw new DOMException('blocked', 'SecurityError')
  }
  return {
    get length() {
      guard()
      return map.size
    },
    clear: () => {
      guard()
      map.clear()
    },
    getItem: (key) => {
      guard()
      return map.get(key) ?? null
    },
    key: (i) => {
      guard()
      return [...map.keys()][i] ?? null
    },
    removeItem: (key) => {
      guard()
      map.delete(key)
    },
    setItem: (key, value) => {
      guard()
      map.set(key, String(value))
    },
  }
}
