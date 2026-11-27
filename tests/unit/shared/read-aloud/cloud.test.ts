import { describe, expect, it } from 'vitest'
import { type CloudVoice, primarySubtag, rankCloudVoices, VOICE_ID } from '~/shared/read-aloud/cloud.ts'

const voice = (name: string, languages: string[]): CloudVoice => ({
  id: name.replaceAll(' ', ''),
  name,
  accent: null,
  gender: null,
  languages,
})

describe('rankCloudVoices', () => {
  it('puts voices verified in the book’s language first, then sorts by name, and keeps every voice', () => {
    const voices = [voice('Zoe', ['en']), voice('Camille', ['fr']), voice('Ben', ['en', 'fr']), voice('Ann', [])]
    expect(rankCloudVoices(voices, 'en-GB').map((v) => v.name)).toEqual(['Ben', 'Zoe', 'Ann', 'Camille'])
    expect(rankCloudVoices(voices, 'fr').map((v) => v.name)).toEqual(['Ben', 'Camille', 'Ann', 'Zoe'])
    expect(rankCloudVoices(voices, 'tr').map((v) => v.name)).toEqual(['Ann', 'Ben', 'Camille', 'Zoe'])
    expect(voices[0]?.name).toBe('Zoe')
  })
})

describe('primarySubtag', () => {
  it('lower-cases the first subtag, Android’s underscores included', () => {
    expect(primarySubtag('en-GB')).toBe('en')
    expect(primarySubtag('PT_br')).toBe('pt')
    expect(primarySubtag('')).toBe('')
  })
})

describe('VOICE_ID', () => {
  it('takes ElevenLabs’ letters-and-digits ids only', () => {
    expect(VOICE_ID.test('21m00Tcm4TlvDq8ikWAM')).toBe(true)
    expect(VOICE_ID.test('../v2')).toBe(false)
    expect(VOICE_ID.test('x'.repeat(65))).toBe(false)
    expect(VOICE_ID.test('')).toBe(false)
  })
})
