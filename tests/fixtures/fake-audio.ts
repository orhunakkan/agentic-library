import { vi } from 'vitest'

type FakeEvent = 'playing' | 'ended' | 'error' | 'play' | 'pause' | 'timeupdate' | 'loadedmetadata'

export function fakeAudio() {
  const listeners = new Map<string, (() => void)[]>()
  const audio = {
    src: '',
    playbackRate: 1,
    preservesPitch: false,
    currentTime: 0,
    duration: Number.NaN,
    volume: 1,
    paused: true,
    played: [] as string[],
    refuse: null as string | null,
    play: vi.fn(async () => {
      audio.played.push(audio.src)
      if (audio.refuse) throw new DOMException('refused', audio.refuse)
      audio.paused = false
    }),
    pause: vi.fn(() => {
      audio.paused = true
    }),
    getAttribute: (name: string) => (name === 'src' && audio.src ? audio.src : null),
    removeAttribute: vi.fn((name: string) => {
      if (name === 'src') audio.src = ''
    }),
    load: vi.fn(),
    addEventListener: (type: string, listener: () => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    fire: (type: FakeEvent) => {
      for (const listener of listeners.get(type) ?? []) listener()
    },
  }
  return audio
}
