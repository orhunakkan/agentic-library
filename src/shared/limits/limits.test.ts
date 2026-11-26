import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMITS } from './limits.ts'

describe('DEFAULT_LIMITS', () => {
  it('are the caps every account had before they became settings, plus 1 MB of article text', () => {
    expect(DEFAULT_LIMITS).toEqual({
      userAudioBytes: 8 * 1024 ** 3,
      audiobookBytes: 2 * 1024 ** 3,
      userPictureBytes: 250 * 1024 ** 2,
      books: 25,
      articles: 500,
      articleTextBytes: 1024 ** 2,
    })
  })
})
