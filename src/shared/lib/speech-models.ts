export const SPEECH_MODELS = [
  { id: 'eleven_v4_turbo', name: 'Eleven v4 Turbo', blurb: 'fast', usdPer1kChars: 0.04 },
  { id: 'eleven_v4', name: 'Eleven v4', blurb: 'the most natural', usdPer1kChars: 0.08 },
] as const

export type SpeechModelId = (typeof SPEECH_MODELS)[number]['id']

export const DEFAULT_SPEECH_MODEL: SpeechModelId = 'eleven_v4_turbo'

export const CHARS_PER_HOUR = 54_000

export function isSpeechModel(value: unknown): value is SpeechModelId {
  return SPEECH_MODELS.some((m) => m.id === value)
}

export function resolveSpeechModel(stored: string | null | undefined): SpeechModelId {
  return isSpeechModel(stored) ? stored : DEFAULT_SPEECH_MODEL
}

const modelOf = (id: SpeechModelId) => SPEECH_MODELS.find((m) => m.id === id) ?? SPEECH_MODELS[0]

export function speechModelName(id: SpeechModelId): string {
  return modelOf(id).name
}

export function costOf(model: SpeechModelId, chars: number): number {
  return Math.round((chars / 1000) * modelOf(model).usdPer1kChars * 100) / 100
}

export const usd = (dollars: number) => `$${dollars.toFixed(2)}`

export function hourlyCost(model: SpeechModelId): string {
  const dollars = Math.round((CHARS_PER_HOUR / 1000) * modelOf(model).usdPer1kChars * 10) / 10
  return `about ${usd(dollars)}`
}

export function speechModelDescription(model: SpeechModelId): string {
  const blurb = modelOf(model).blurb
  return `${blurb.charAt(0).toUpperCase()}${blurb.slice(1)}, ${hourlyCost(model)} an hour of listening`
}
