export type Shell = 'reader' | 'home' | 'app'

export function shellFor(pathname: string): Shell {
  if (pathname.startsWith('/read/')) return 'reader'
  return pathname === '/' || pathname === '' ? 'home' : 'app'
}

export type MainItem = 'library' | 'listen' | 'my-books' | 'articles' | 'highlights' | 'stats' | 'repos'

const isLibraryIndex = (pathname: string) => pathname === '/library' || pathname === '/library/'

export function activeMainItem(pathname: string, filter: string | undefined): MainItem | null {
  if (pathname === '/account/books' || pathname.startsWith('/account/books/')) return 'my-books'
  if (pathname === '/account/articles' || pathname === '/account/articles/') return 'articles'
  if (pathname === '/account/highlights' || pathname === '/account/highlights/') return 'highlights'
  if (pathname === '/account/stats' || pathname === '/account/stats/') return 'stats'
  if (pathname === '/account/repos' || pathname.startsWith('/account/repos/')) return 'repos'
  if (isLibraryIndex(pathname)) {
    if (filter === 'audio') return 'listen'
    return filter ? null : 'library'
  }
  if (pathname.startsWith('/library/')) return 'library'
  return null
}

export function isCollectionActive(
  collection: { slug: string; href: string },
  pathname: string,
  filter: string | undefined,
): boolean {
  if (isLibraryIndex(pathname)) return filter === collection.slug
  return !collection.href.includes('?') && pathname === collection.href
}
