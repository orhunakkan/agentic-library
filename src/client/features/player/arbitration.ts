import { browserTimers, type Timers } from '~/client/features/read-aloud/speaker'
import { SLEEP_OFF, type Sleep, type SleepChoice, startSleep, tick } from './sleep'

export interface ArbiterDeps {
  audiobook: { loaded: () => boolean; close: () => void; pause: () => void; fadeOut: () => void }
  voice: {
    loaded: () => boolean
    close: () => void
    stopAfterSentence: () => void
    setStopAtChapterEnd: (on: boolean) => void
  }
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
  beforeVoice: () => void
  beforeAside: () => void
  playing: (source: 'audiobook' | 'voice', on: boolean) => void
  closed: () => void
  setSleep: (choice: SleepChoice) => void
  partEnded: () => 'stop' | 'continue'
  voiceSlept: () => void
  state: () => ArbiterState
  dispose: () => void
}

const TICK_MS = 1000

export function createArbiter(deps: ArbiterDeps): Arbiter {
  const timers = deps.timers ?? browserTimers
  let sleep: Sleep = SLEEP_OFF
  let sleepChoice: SleepChoice = 'off'
  const on = { audiobook: false, voice: false }
  let ticking: unknown = null
  let disposed = false

  const state = (): ArbiterState => ({ sleep, sleepChoice, playing: on.audiobook || on.voice })

  const reconcile = () => {
    const wanted = !disposed && state().playing && sleep.kind === 'minutes'
    if (wanted && ticking === null) ticking = timers.setTimeout(onTick, TICK_MS)
    else if (!wanted && ticking !== null) {
      timers.clearTimeout(ticking)
      ticking = null
    }
  }

  const setSleepState = (next: Sleep, choice: SleepChoice = sleepChoice) => {
    const wasEndOfPart = sleep.kind === 'end-of-part'
    sleep = next
    sleepChoice = choice
    if (wasEndOfPart !== (next.kind === 'end-of-part')) deps.voice.setStopAtChapterEnd(next.kind === 'end-of-part')
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
      deps.voice.stopAfterSentence()
    }
  }

  return {
    beforeAudiobook: () => {
      if (!deps.voice.loaded()) return
      deps.voice.close()
      sleepOff()
    },
    beforeVoice: () => {
      if (!deps.audiobook.loaded()) return
      deps.audiobook.close()
      sleepOff()
    },
    beforeAside: () => deps.audiobook.pause(),
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
    voiceSlept: sleepEnded,
    state,
    dispose: () => {
      disposed = true
      reconcile()
    },
  }
}
