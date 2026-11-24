import { browserTimers, type Timers } from '~/client/features/read-aloud/speaker'
import { SLEEP_OFF, type Sleep, type SleepChoice, startSleep, tick } from './sleep'

export interface ArbiterDeps {
  audiobook: { loaded: () => boolean; close: () => void; pause: () => void; fadeOut: () => void }
  readAloud: { loaded: () => boolean; close: () => void; pause: () => void; stopAfterSentence: () => void }
  aside: { interrupt: () => void }
  timers?: Timers
  onSleepEnded: () => void
  onChange: (state: ArbiterState) => void
}

export interface ArbiterState {
  sleep: Sleep
  sleepChoice: SleepChoice
  playing: boolean
}

export interface Arbiter {
  beforeAudiobook: () => void
  beforeReadAloud: () => void
  beforeAside: () => void
  playing: (source: Source, on: boolean) => void
  closed: () => void
  setSleep: (choice: SleepChoice) => void
  partEnded: () => 'stop' | 'continue'
  readAloudSlept: () => void
  state: () => ArbiterState
  dispose: () => void
}

/** The two playback sources, one playing at a time. */
export type Source = 'audiobook' | 'read-aloud'

const TICK_MS = 1000

export function createArbiter(deps: ArbiterDeps): Arbiter {
  const timers = deps.timers ?? browserTimers
  let sleep: Sleep = SLEEP_OFF
  let sleepChoice: SleepChoice = 'off'
  const on: Record<Source, boolean> = { audiobook: false, 'read-aloud': false }
  let ticking: unknown = null
  let disposed = false

  const state = (): ArbiterState => ({ sleep, sleepChoice, playing: on.audiobook || on['read-aloud'] })

  const reconcile = () => {
    const wanted = !disposed && state().playing && sleep.kind === 'minutes'
    if (wanted && ticking === null) ticking = timers.setTimeout(onTick, TICK_MS)
    else if (!wanted && ticking !== null) {
      timers.clearTimeout(ticking)
      ticking = null
    }
  }

  const setSleepState = (next: Sleep, choice: SleepChoice = sleepChoice) => {
    sleep = next
    sleepChoice = choice
    reconcile()
    deps.onChange(state())
  }
  const sleepOff = () => setSleepState(SLEEP_OFF, 'off')
  const sleepEnded = () => {
    sleepOff()
    deps.onSleepEnded()
  }

  function onTick() {
    ticking = null
    const { state: left, done } = tick(sleep, TICK_MS)
    if (!done) return setSleepState(left)
    if (deps.audiobook.loaded()) {
      sleepEnded()
      deps.audiobook.fadeOut()
    } else {
      setSleepState(SLEEP_OFF)
      deps.readAloud.stopAfterSentence()
    }
  }

  return {
    beforeAudiobook: () => {
      if (!deps.readAloud.loaded()) return
      deps.readAloud.close()
      sleepOff()
    },
    beforeReadAloud: () => {
      if (!deps.audiobook.loaded()) return
      deps.audiobook.close()
      sleepOff()
    },
    beforeAside: () => {
      deps.audiobook.pause()
      deps.readAloud.pause()
    },
    playing: (source, playing) => {
      if (playing) deps.aside.interrupt()
      if (on[source] === playing) return
      on[source] = playing
      reconcile()
      deps.onChange(state())
    },
    closed: sleepOff,
    setSleep: (choice) => setSleepState(startSleep(choice), choice),
    partEnded: () => {
      if (sleep.kind !== 'end-of-part') return 'continue'
      sleepEnded()
      return 'stop'
    },
    readAloudSlept: sleepEnded,
    state,
    dispose: () => {
      disposed = true
      reconcile()
    },
  }
}
