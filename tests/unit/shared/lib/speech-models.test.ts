import { describe, expect, it } from 'vitest'
import {
  CHARS_PER_HOUR,
  costOf,
  DEFAULT_SPEECH_MODEL,
  hourlyCost,
  isSpeechModel,
  resolveSpeechModel,
  SPEECH_MODELS,
  speechModelDescription,
  speechModelName,
  usd,
} from '~/shared/lib/speech-models'

describe('speech models', () => {
  it('offers Eleven v4 Turbo (the default) and Eleven v4', () => {
    expect(SPEECH_MODELS.map((m) => m.id)).toEqual(['eleven_v4_turbo', 'eleven_v4'])
    expect(DEFAULT_SPEECH_MODEL).toBe('eleven_v4_turbo')
    expect(speechModelName('eleven_v4')).toBe('Eleven v4')
  })

  it('reads null and unknown stored values as the default', () => {
    expect(resolveSpeechModel(null)).toBe('eleven_v4_turbo')
    expect(resolveSpeechModel(undefined)).toBe('eleven_v4_turbo')
    expect(resolveSpeechModel('eleven_v9_retired')).toBe('eleven_v4_turbo')
    expect(resolveSpeechModel('eleven_v4')).toBe('eleven_v4')
    expect(isSpeechModel('ELEVEN_V4')).toBe(false)
    expect(isSpeechModel(4)).toBe(false)
  })

  it('says an hour of listening to ten cents', () => {
    expect(CHARS_PER_HOUR).toBe(54_000)
    expect(hourlyCost('eleven_v4_turbo')).toBe('about $2.20')
    expect(hourlyCost('eleven_v4')).toBe('about $4.30')
    expect(speechModelDescription('eleven_v4_turbo')).toBe('Fast, about $2.20 an hour of listening')
    expect(speechModelDescription('eleven_v4')).toBe('The most natural, about $4.30 an hour of listening')
  })

  it('costs characters to the cent', () => {
    expect(costOf('eleven_v4_turbo', 54_210)).toBe(2.17)
    expect(costOf('eleven_v4', 54_210)).toBe(4.34)
    expect(costOf('eleven_v4_turbo', 0)).toBe(0)
    expect(costOf('eleven_v4_turbo', 124)).toBe(0)
    expect(costOf('eleven_v4_turbo', 125)).toBe(0.01)
    expect(usd(2.17)).toBe('$2.17')
    expect(usd(0)).toBe('$0.00')
  })
})
