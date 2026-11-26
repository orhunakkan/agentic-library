import { describe, expect, it } from 'vitest'
import type { AccountStorage } from '~/shared/limits/limits'
import { DEFAULT_LIMITS } from '~/shared/limits/limits'
import { OVER_LIMIT_TEXT, storageLines } from './storage-text'

const MiB = 1024 ** 2
const GiB = 1024 ** 3
const HOSTED = { ...DEFAULT_LIMITS, userAudioBytes: GiB, audiobookBytes: GiB, userPictureBytes: 100 * MiB }

const storage = (over: Partial<AccountStorage> = {}): AccountStorage => ({
  bookCount: 3,
  articleCount: 12,
  audioBytes: 412 * MiB,
  pictureBytes: 40 * MiB,
  audiobooks: true,
  limits: HOSTED,
  ...over,
})

describe('storageLines', () => {
  it('says each line as a count or a size against its limit, with its meter', () => {
    expect(storageLines(storage())).toEqual([
      { key: 'books', label: 'Books', text: '3 of 25 books', value: 3, max: 25, over: false },
      { key: 'articles', label: 'Saved articles', text: '12 of 500 saved articles', value: 12, max: 500, over: false },
      {
        key: 'audio',
        label: 'Audiobooks',
        text: '412 MB of 1 GB of audiobooks',
        value: 412 * MiB,
        max: GiB,
        over: false,
      },
      {
        key: 'pictures',
        label: 'Pictures',
        text: '40 MB of 100 MB of pictures',
        value: 40 * MiB,
        max: 100 * MiB,
        over: false,
      },
    ])
  })

  it('counts one of one in the singular, and nothing used as 0', () => {
    const limits = { ...HOSTED, books: 1, articles: 1 }
    const [books, articles, audio] = storageLines(storage({ bookCount: 0, articleCount: 1, audioBytes: 0, limits }))
    expect(books?.text).toBe('0 of 1 book')
    expect(articles?.text).toBe('1 of 1 saved article')
    expect(audio?.text).toBe('0 KB of 1 GB of audiobooks')
  })

  it('leaves out the audiobooks when they are off on this server', () => {
    expect(storageLines(storage({ audiobooks: false })).map((line) => line.key)).toEqual([
      'books',
      'articles',
      'pictures',
    ])
  })

  it('shows a full meter and says so when usage is past a lowered limit', () => {
    const [books, , audio] = storageLines(storage({ bookCount: 30, audioBytes: 2 * GiB }))
    expect(books).toMatchObject({ text: '30 of 25 books', value: 25, max: 25, over: true })
    expect(audio).toMatchObject({ text: '2 GB of 1 GB of audiobooks', value: GiB, max: GiB, over: true })
    const [full] = storageLines(storage({ bookCount: 25 }))
    expect(full).toMatchObject({ value: 25, over: false })
    expect(OVER_LIMIT_TEXT).toBe('Over the limit, delete some to add more.')
  })
})
