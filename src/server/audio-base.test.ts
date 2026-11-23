import { describe, expect, it } from 'vitest'
import { rebaseAudioUrl } from './audio-base'

describe('rebaseAudioUrl', () => {
  const url = 'https://www.archive.org/download/the_prophet_2109_librivox/theprophet_02_gibran_64kb.mp3'

  it('keeps the original URL when no base is configured', () => {
    expect(rebaseAudioUrl(url, undefined)).toBe(url)
    expect(rebaseAudioUrl(url, '')).toBe(url)
  })

  it('serves the recording folder and file name from the configured base', () => {
    expect(rebaseAudioUrl(url, '/test-audio/')).toBe(
      '/test-audio/the_prophet_2109_librivox/theprophet_02_gibran_64kb.mp3',
    )
    expect(rebaseAudioUrl(url, 'http://nas.local/librivox')).toBe(
      'http://nas.local/librivox/the_prophet_2109_librivox/theprophet_02_gibran_64kb.mp3',
    )
  })
})
