export type EmptyState = 'no-results' | 'removed' | 'empty' | 'signed-out'

export function emptyLibrary({
  browsing,
  removedAny,
  signedIn,
}: {
  browsing: boolean
  removedAny: boolean
  signedIn: boolean
}): EmptyState {
  if (!browsing) return 'no-results'
  if (!signedIn) return 'signed-out'
  return removedAny ? 'removed' : 'empty'
}

export const SIGNED_OUT_EMPTY = {
  title: 'Bring your own books.',
  body: 'Create a free account to import EPUB, PDF and Markdown books and save articles.',
  createAccount: { label: 'Create account', href: '/signup' },
  signIn: { label: 'Sign in', href: '/login', next: '/library' },
} as const

export function libraryHeading({ stats, removed }: { stats: { books: number }; removed: readonly unknown[] }): {
  showsStats: boolean
  description: string
} {
  const showsStats = stats.books + removed.length > 0
  return {
    showsStats,
    description: showsStats ? `${stats.books} books to read and listen to.` : 'Your books, to read and listen to.',
  }
}
