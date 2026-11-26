import { GB } from '../audiobooks/limits.ts'
import { MB } from '../import/limits.ts'

/** The storage caps an operator sets with the LIMIT_* variables, the same for every account. */
export interface InstanceLimits {
  userAudioBytes: number
  audiobookBytes: number
  userPictureBytes: number
  books: number
  articles: number
  articleTextBytes: number
}

/** What a server gets with no LIMIT_* set. Only parseConfig and tests read these. */
export const DEFAULT_LIMITS: InstanceLimits = {
  userAudioBytes: 8 * GB,
  audiobookBytes: 2 * GB,
  userPictureBytes: 250 * MB,
  books: 25,
  articles: 500,
  articleTextBytes: 1 * MB,
}

/** What the account page's Storage section shows: what the reader holds, beside the limits that apply. */
export interface AccountStorage {
  bookCount: number
  articleCount: number
  audioBytes: number
  pictureBytes: number
  audiobooks: boolean
  limits: InstanceLimits
}
