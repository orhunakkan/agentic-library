export type Sleep = { kind: 'off' } | { kind: 'minutes'; leftMs: number } | { kind: 'end-of-part' }

export type SleepChoice = 'off' | 15 | 30 | 45 | 60 | 'end-of-part'

export const SLEEP_CHOICES: readonly SleepChoice[] = ['off', 15, 30, 45, 60, 'end-of-part']

export type Part = 'episode' | 'chapter'

export const SLEEP_OFF: Sleep = { kind: 'off' }

export function startSleep(choice: SleepChoice): Sleep {
  if (choice === 'off') return SLEEP_OFF
  if (choice === 'end-of-part') return { kind: 'end-of-part' }
  return { kind: 'minutes', leftMs: choice * 60_000 }
}

export function tick(state: Sleep, elapsedMs: number): { state: Sleep; done: boolean } {
  if (state.kind !== 'minutes' || elapsedMs <= 0) return { state, done: false }
  const leftMs = state.leftMs - elapsedMs
  return leftMs <= 0 ? { state: SLEEP_OFF, done: true } : { state: { kind: 'minutes', leftMs }, done: false }
}

export function label(state: Sleep, part: Part): string | null {
  if (state.kind === 'off') return null
  if (state.kind === 'end-of-part') return `Sleep · End of ${part}`
  return `Sleep · ${Math.max(1, Math.ceil(state.leftMs / 60_000))} min`
}

export function choiceLabel(choice: SleepChoice, part: Part): string {
  if (choice === 'off') return 'Off'
  if (choice === 'end-of-part') return `End of ${part}`
  return `${choice} min`
}
