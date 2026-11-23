import { describe, expect, it } from 'vitest'
import {
  ELEVENLABS_SEEN_KEY,
  elevenLabsNoteSeen,
  markElevenLabsNoteSeen,
  ONLINE_KEY,
  onlineAgreed,
  SPEAK_KEY,
  setOnlineAgreed,
  setSpeakAnswers,
  speakAnswers,
} from './voice-prefs'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  }
}

const broken = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('full')
  },
  removeItem: () => {
    throw new Error('blocked')
  },
} as unknown as Storage

describe('voice prefs', () => {
  it('remembers online consent as "yes", and forgets it when withdrawn', () => {
    const storage = memoryStorage()
    expect(onlineAgreed(storage)).toBe(false)
    setOnlineAgreed(storage, true)
    expect(storage.getItem(ONLINE_KEY)).toBe('yes')
    expect(onlineAgreed(storage)).toBe(true)
    setOnlineAgreed(storage, false)
    expect(storage.getItem(ONLINE_KEY)).toBeNull()
    expect(onlineAgreed(storage)).toBe(false)
  })

  it('reads answers aloud unless turned off', () => {
    const storage = memoryStorage()
    expect(speakAnswers(storage)).toBe(true)
    setSpeakAnswers(storage, false)
    expect(storage.getItem(SPEAK_KEY)).toBe('off')
    expect(speakAnswers(storage)).toBe(false)
    setSpeakAnswers(storage, true)
    expect(storage.getItem(SPEAK_KEY)).toBe('on')
    expect(speakAnswers(storage)).toBe(true)
  })

  it('shows the ElevenLabs note once', () => {
    const storage = memoryStorage()
    expect(elevenLabsNoteSeen(storage)).toBe(false)
    markElevenLabsNoteSeen(storage)
    expect(storage.getItem(ELEVENLABS_SEEN_KEY)).toBe('yes')
    expect(elevenLabsNoteSeen(storage)).toBe(true)
  })

  it('a missing or broken store means no memory, never an error', () => {
    for (const storage of [null, broken]) {
      expect(onlineAgreed(storage)).toBe(false)
      expect(speakAnswers(storage)).toBe(true)
      expect(elevenLabsNoteSeen(storage)).toBe(false)
      expect(() => {
        setOnlineAgreed(storage, true)
        setOnlineAgreed(storage, false)
        setSpeakAnswers(storage, false)
        markElevenLabsNoteSeen(storage)
      }).not.toThrow()
    }
  })
})
