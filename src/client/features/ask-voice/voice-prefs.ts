export const ONLINE_KEY = 'ask-voice-online'
export const SPEAK_KEY = 'ask-voice-speak'
export const ELEVENLABS_SEEN_KEY = 'ask-voice-elevenlabs-seen'

function read(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(storage: Storage | null, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key)
    else storage?.setItem(key, value)
  } catch {}
}

export const onlineAgreed = (storage: Storage | null) => read(storage, ONLINE_KEY) === 'yes'

export const setOnlineAgreed = (storage: Storage | null, agreed: boolean) =>
  write(storage, ONLINE_KEY, agreed ? 'yes' : null)

export const speakAnswers = (storage: Storage | null) => read(storage, SPEAK_KEY) !== 'off'

export const setSpeakAnswers = (storage: Storage | null, on: boolean) => write(storage, SPEAK_KEY, on ? 'on' : 'off')

export const elevenLabsNoteSeen = (storage: Storage | null) => read(storage, ELEVENLABS_SEEN_KEY) === 'yes'

export const markElevenLabsNoteSeen = (storage: Storage | null) => write(storage, ELEVENLABS_SEEN_KEY, 'yes')
