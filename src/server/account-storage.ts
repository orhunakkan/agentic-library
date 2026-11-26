import '@tanstack/react-start/server-only'
import type { AccountStorage } from '../shared/limits/limits.ts'
import { audiobooksOn } from './audiobooks/files.ts'
import { audioBytesUsed } from './audiobooks/store.ts'
import { imageBytesUsed } from './book-images/store.ts'
import { getConfig } from './config.ts'
import type { Db } from './db.ts'
import { countedArticles, countedBooks } from './user-books.ts'

/** The reader's usage, counted as the quota checks count it, so the page and a refusal never disagree. */
export async function accountStorage(db: Db, userId: number): Promise<AccountStorage> {
  const [bookCount, articleCount, audioBytes, pictureBytes, audiobooks] = await Promise.all([
    countedBooks(db, userId),
    countedArticles(db, userId),
    audioBytesUsed(db, userId),
    imageBytesUsed(db, userId),
    audiobooksOn(),
  ])
  return { bookCount, articleCount, audioBytes, pictureBytes, audiobooks, limits: getConfig().limits }
}
