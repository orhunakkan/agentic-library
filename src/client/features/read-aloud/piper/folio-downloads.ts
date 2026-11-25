import { dismissOffer, offerDismissed } from '~/client/features/read-aloud/position-store'
import { folioVoiceLike, type VoiceLike } from '~/client/features/read-aloud/voices'
import { ENGINE_BYTES, type FolioVoice, folioVoicesFor } from '~/shared/read-aloud/folio-voices'
import type { DownloadOutcome, VoiceStore } from './voice-store'

export interface LocalVoiceState {
  id: string
  voice: VoiceLike
  state: 'absent' | 'downloading' | 'ready'
  percent: number
  bytes: number
}

export interface LocalState {
  voices: LocalVoiceState[]
  offer: boolean
  slow: boolean
  removable: number
}

export const NO_LOCAL: LocalState = { voices: [], offer: false, slow: false, removable: 0 }

/** How a download ended, with the size it was offered at, which a `no_room` notice names. */
export interface DownloadFinished {
  voice: FolioVoice
  outcome: DownloadOutcome
  bytes: number
}

export interface FolioDownloadsDeps {
  voiceStore: VoiceStore
  storage: Storage | null
  locale?: string
  /** Called when what `local` shows changes outside `refresh`, `download` and `remove`, such as download progress. */
  onChange: () => void
}

export interface FolioDownloads {
  /** What the store has downloaded, kept for `local`; a failure counts as none. */
  refresh: () => Promise<FolioVoice[]>
  local: (lang: string) => LocalState
  /** Resolves once the download ends and the downloaded list is fresh, or null when it can't start. */
  download: (id: string, lang: string) => Promise<DownloadFinished | null>
  cancel: () => void
  /** Removes the language's Folio voices and resolves with them once the downloaded list is fresh. */
  remove: (lang: string) => Promise<FolioVoice[]>
  dismissOffer: () => void
  noteSlow: () => void
}

/** The Folio voices on the device: which are downloaded, the one downloading, and the offer to download one. */
export function createFolioDownloads(deps: FolioDownloadsDeps): FolioDownloads {
  let downloaded: readonly FolioVoice[] = []
  let refreshes = 0
  let inFlight: { id: string; percent: number; controller: AbortController } | null = null
  let slow = false

  const refresh = async () => {
    const mine = ++refreshes
    const found = await deps.voiceStore.downloaded().catch((): FolioVoice[] => [])
    if (mine === refreshes) downloaded = found
    return found
  }

  const local = (lang: string): LocalState => {
    const ready = new Set(downloaded.map((v) => v.id))
    const folioVoices = folioVoicesFor(lang, deps.locale)
    const voices = folioVoices.map(
      (folioVoice): LocalVoiceState => ({
        id: folioVoice.id,
        voice: folioVoiceLike(folioVoice),
        state: ready.has(folioVoice.id) ? 'ready' : inFlight?.id === folioVoice.id ? 'downloading' : 'absent',
        percent: inFlight?.id === folioVoice.id ? inFlight.percent : 0,
        bytes: folioVoice.bytes + (downloaded.length > 0 ? 0 : ENGINE_BYTES),
      }),
    )
    const removable = folioVoices.filter((v) => ready.has(v.id)).reduce((n, v) => n + v.bytes, 0)
    const offer =
      voices.length > 0 && voices.every((v) => v.state !== 'ready') && !inFlight && !offerDismissed(deps.storage)
    return { voices, offer, slow, removable }
  }

  return {
    refresh,
    local,
    download: async (id, lang) => {
      const voice = folioVoicesFor(lang, deps.locale).find((v) => v.id === id)
      const entry = local(lang).voices.find((v) => v.id === id)
      if (!voice || !entry || entry.state !== 'absent' || inFlight) return null
      const mine = { id, percent: 0, controller: new AbortController() }
      inFlight = mine
      deps.onChange()
      const outcome = await deps.voiceStore.download(
        voice,
        (percent) => {
          if (inFlight !== mine || percent === mine.percent) return
          mine.percent = percent
          deps.onChange()
        },
        mine.controller.signal,
      )
      inFlight = null
      await refresh()
      return { voice, outcome, bytes: entry.bytes }
    },
    cancel: () => inFlight?.controller.abort(),
    remove: async (lang) => {
      const voices = folioVoicesFor(lang, deps.locale)
      await deps.voiceStore.remove(voices).catch(() => {})
      await refresh()
      return voices
    },
    dismissOffer: () => {
      dismissOffer(deps.storage)
      deps.onChange()
    },
    noteSlow: () => {
      slow = true
      deps.onChange()
    },
  }
}
