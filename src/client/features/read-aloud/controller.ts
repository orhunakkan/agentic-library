import type { Arbiter } from '~/client/features/player/arbitration'
import { isPrivateBookSlug } from '~/shared/content/book-slug'
import { type PagePosition, samePosition } from '~/shared/content/position'
import { primarySubtag, type SpeechVoicesState } from '~/shared/read-aloud/cloud'
import { ENGINE_BYTES, type FolioVoice, folioVoicesFor } from '~/shared/read-aloud/folio-voices'
import { chapterIntro } from '~/shared/read-aloud/sentences'
import type { SpeechBook, SpeechChapter, SpeechChapterData } from '~/shared/read-aloud/speech-text'
import { CLOUD_VOICE_PREFIX, type SpeakRef } from './cloud-speaker'
import {
  atFraction,
  atOffset,
  type Cursor,
  first,
  fraction,
  minutesLeft,
  next,
  onLastPage,
  type Plan,
  planChapter,
  prev,
  utteranceAt,
} from './cursor'
import type { DownloadNotice } from './messages'
import type { VoiceStore } from './piper/voice-store'
import {
  dismissOffer,
  finishPosition,
  forgetVoice,
  offerDismissed,
  readPosition,
  readSpeed,
  readVoices,
  rememberVoice,
  type SavedPosition,
  voiceChoiceKey,
  writePosition,
  writeSpeed,
} from './position-store'
import type { Speaker } from './speaker'
import {
  folioVoiceLike,
  isCloudVoice,
  isLocalVoice,
  languageName,
  pickVoice,
  rankCloudVoices,
  resolveVoice,
  type VoiceLike,
} from './voices'

export type FetchResult = { ok: true; data: SpeechChapterData } | { ok: false; reason: 'not-found' | 'failed' }

export type Problem =
  | { kind: 'no-voice'; language: string }
  | { kind: 'unavailable' }
  | { kind: 'load-failed' }
  | { kind: 'voice-failed' }
  | { kind: 'end-of-book' }
  | { kind: 'cloud'; code: CloudProblemCode; retryAt?: number }
  | { kind: 'local'; code: LocalProblemCode }

const LOCAL_CODES = ['local_missing', 'local_failed'] as const

export type LocalProblemCode = (typeof LOCAL_CODES)[number]

const isLocalProblem = (error: string): error is LocalProblemCode => (LOCAL_CODES as readonly string[]).includes(error)

const CLOUD_CODES = [
  'key_rejected',
  'no_credits',
  'permission',
  'voice_gone',
  'busy',
  'rate',
  'no_key',
  'signed_out',
  'pro',
  'blocked',
] as const

export type CloudProblemCode = (typeof CLOUD_CODES)[number]

const isCloudProblem = (error: string): error is CloudProblemCode => (CLOUD_CODES as readonly string[]).includes(error)

export type CloudVoices = 'off' | 'loading' | 'failed' | 'permission' | 'pro' | 'no-key' | VoiceLike[]

export type Status = 'loading' | 'playing' | 'paused' | 'ended' | 'error'

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

export interface ReadAloudState {
  book: SpeechBook | null
  chapter: Pick<SpeechChapter, 'index' | 'slug' | 'title' | 'number' | 'chapterCount'> | null
  page: { index: number; href: string; label: string; position: PagePosition } | null
  utterance: { start: number; end: number } | null
  status: Status
  following: boolean
  rate: number
  voice: VoiceLike | null
  voices: VoiceLike[]
  cloudVoices: CloudVoices
  cloudModel: string | null
  engine: 'device' | 'cloud' | 'local'
  local: LocalState
  problem: Problem | null
  fraction: number
  minutesLeft: number
}

export type StartAt =
  | { kind: 'saved' }
  | { kind: 'page'; chapter: number; position: PagePosition }
  | { kind: 'offset'; chapter: number; position: PagePosition; offset: number }

export interface ControllerDeps {
  speaker: Speaker
  cloudSpeaker?: Speaker & { prime: () => void; close: () => void }
  localSpeaker?: Speaker & { prime: () => void; close: () => void }
  voiceStore?: VoiceStore
  onNotice?: (notice: DownloadNotice) => void
  loadCloudVoices?: (book: string) => Promise<SpeechVoicesState>
  loadVoices: () => Promise<VoiceLike[]>
  fetchChapter: (book: string, chapter: number) => Promise<FetchResult>
  storage: Storage | null
  onState: (state: ReadAloudState) => void
  /** Read aloud reports to the arbiter, and asks it whether to stop at a chapter's end. */
  arbiter: Pick<Arbiter, 'beforeReadAloud' | 'playing' | 'closed' | 'partEnded' | 'readAloudSlept'>
  locale?: string
  now?: () => number
  onSaved?: (book: string, saved: Omit<SavedPosition, 'v'> | null) => void
}

export interface ReadAloud {
  start: (book: string, at: StartAt) => void
  toggle: () => void
  pause: () => void
  nextSentence: () => void
  prevSentence: () => void
  nextChapter: () => void
  prevChapter: () => void
  toChapter: (index: number) => void
  seekFraction: (f: number) => void
  setRate: (rate: number) => void
  setVoice: (voiceURI: string) => void
  useDeviceVoice: () => void
  retryCloudVoices: () => void
  downloadLocal: (id: string) => void
  cancelDownload: () => void
  removeLocal: () => void
  dismissOffer: () => void
  noteSlow: () => void
  setFollowing: (following: boolean) => void
  stopAfterSentence: () => void
  retry: () => void
  close: () => void
  state: () => ReadAloudState
}

export const SAVE_EVERY_MS = 5000
export const MAX_FAILURES = 3

const sameCursor = (a: Cursor | null, b: Cursor | null) =>
  a !== null && b !== null && a.pageIndex === b.pageIndex && a.utteranceIndex === b.utteranceIndex

const hasNextChapter = (chapter: Pick<SpeechChapter, 'index' | 'chapterCount'>) =>
  chapter.index + 1 < chapter.chapterCount

const NO_LOCAL: LocalState = { voices: [], offer: false, slow: false, removable: 0 }

export const closedState = (rate: number): ReadAloudState => ({
  book: null,
  chapter: null,
  page: null,
  utterance: null,
  status: 'paused',
  following: true,
  rate,
  voice: null,
  voices: [],
  cloudVoices: 'off',
  cloudModel: null,
  engine: 'device',
  local: NO_LOCAL,
  problem: null,
  fraction: 0,
  minutesLeft: 0,
})

const cloudVoicesOf = (answer: SpeechVoicesState, lang: string): CloudVoices => {
  switch (answer.state) {
    case 'ready':
      return rankCloudVoices(answer.voices, lang)
    case 'signed_out':
      return 'off'
    case 'no_key':
      return 'no-key'
    case 'pro':
      return 'pro'
    case 'permission':
      return 'permission'
    default:
      return 'failed'
  }
}

export function createReadAloud(deps: ControllerDeps): ReadAloud {
  const now = deps.now ?? Date.now
  const closed = () => closedState(readSpeed(deps.storage))
  let state = closed()
  let download: { id: string; percent: number; controller: AbortController } | null = null
  let slow = false
  let cloudList: { book: string; answer: Promise<SpeechVoicesState> } | null = null
  let session = 0
  let slug: string | null = null
  let chapters = new Map<number, Promise<FetchResult>>()
  let current: { data: SpeechChapterData; plan: Plan } | null = null
  let cursor: Cursor | null = null
  let intro = false
  let failures = 0
  let lastSave = 0
  let stopAfter = false
  let retryAction: (() => void) | null = null

  const publish = () => {
    deps.onState(state)
    deps.arbiter.playing('read-aloud', state.status === 'playing')
  }

  const emit = (patch: Partial<ReadAloudState> = {}) => {
    state = { ...state, ...patch }
    if (current && cursor) {
      const page = current.data.chapter.pages[cursor.pageIndex]
      const u = intro ? null : utteranceAt(current.plan, cursor)
      state = {
        ...state,
        page: page ? { index: cursor.pageIndex, href: page.href, label: page.label, position: page.position } : null,
        utterance: u ? { start: u.start, end: u.end } : null,
        fraction: fraction(current.plan, cursor),
        minutesLeft: minutesLeft(current.plan, cursor, state.rate),
      }
    }
    publish()
  }

  const save = () => {
    if (!slug || !current || !cursor) return
    const u = utteranceAt(current.plan, cursor)
    const page = current.data.chapter.pages[cursor.pageIndex]
    if (!u || !page) return
    lastSave = now()
    const saved = { chapter: current.data.chapter.index, position: page.position, offset: u.start, at: lastSave }
    writePosition(deps.storage, slug, saved)
    deps.onSaved?.(slug, saved)
  }

  const getChapter = (index: number): Promise<FetchResult> => {
    const book = slug
    if (!book) return Promise.resolve({ ok: false, reason: 'failed' })
    let found = chapters.get(index)
    if (!found) {
      found = deps.fetchChapter(book, index).catch((): FetchResult => ({ ok: false, reason: 'failed' }))
      chapters.set(index, found)
      void found.then((r) => {
        if (!r.ok && chapters.get(index) === found) chapters.delete(index)
      })
    }
    return found
  }

  const cloudOn = () => isCloudVoice(state.voice) && deps.cloudSpeaker !== undefined
  const localOn = () => isLocalVoice(state.voice) && deps.localSpeaker !== undefined
  const speaker = (): Speaker => {
    if (cloudOn()) return deps.cloudSpeaker as Speaker
    if (localOn()) return deps.localSpeaker as Speaker
    return deps.speaker
  }
  const stopSpeaking = () => {
    deps.speaker.stop()
    deps.cloudSpeaker?.stop()
    deps.localSpeaker?.stop()
  }
  const engineOf = (voice: VoiceLike | null): ReadAloudState['engine'] => {
    if (isCloudVoice(voice)) return 'cloud'
    if (isLocalVoice(voice)) return 'local'
    return 'device'
  }

  const upcomingTexts = (count: number): string[] => {
    if (!current || !cursor) return []
    const texts: string[] = []
    let at: Cursor | null = intro ? cursor : next(current.plan, cursor)
    while (at && texts.length < count) {
      const u = utteranceAt(current.plan, at)
      if (u) texts.push(u.say)
      at = next(current.plan, at)
    }
    return texts
  }

  const localStateFor = (lang: string, downloaded: readonly FolioVoice[]): LocalState => {
    if (!deps.voiceStore) return NO_LOCAL
    const ready = new Set(downloaded.map((v) => v.id))
    const folioVoices = folioVoicesFor(lang, deps.locale)
    const voices = folioVoices.map(
      (v): LocalVoiceState => ({
        id: v.id,
        voice: folioVoiceLike(v),
        state: ready.has(v.id) ? 'ready' : download?.id === v.id ? 'downloading' : 'absent',
        percent: download?.id === v.id ? download.percent : 0,
        bytes: v.bytes + (downloaded.length > 0 ? 0 : ENGINE_BYTES),
      }),
    )
    const removable = folioVoices.filter((v) => ready.has(v.id)).reduce((n, v) => n + v.bytes, 0)
    const offer =
      voices.length > 0 && voices.every((v) => v.state !== 'ready') && !download && !offerDismissed(deps.storage)
    return { voices, offer, slow, removable }
  }

  const downloadedVoices = async (): Promise<FolioVoice[]> =>
    deps.voiceStore ? deps.voiceStore.downloaded().catch(() => []) : []

  const refreshLocal = async (mine: number) => {
    const lang = state.book?.language
    if (!lang || !deps.voiceStore) return
    const downloaded = await downloadedVoices()
    if (mine !== session || state.book?.language !== lang) return
    emit({ local: localStateFor(lang, downloaded) })
  }

  const refAt = (at: Cursor, asIntro: boolean): SpeakRef | null => {
    if (!slug || !current) return null
    const chapter = current.data.chapter.index
    if (asIntro) return { book: slug, chapter, intro: true }
    const u = utteranceAt(current.plan, at)
    const page = current.data.chapter.pages[at.pageIndex]
    return u && page ? { book: slug, chapter, position: page.position, start: u.start, end: u.end } : null
  }

  const upcomingRef = (): SpeakRef | null => {
    if (!current || !cursor || !slug) return null
    if (intro) return refAt(cursor, false)
    const following = next(current.plan, cursor)
    if (following) return refAt(following, false)
    const chapter = current.data.chapter
    return hasNextChapter(chapter) ? { book: slug, chapter: chapter.index + 1, intro: true } : null
  }

  const options = () => {
    const ref = cursor && cloudOn() ? refAt(cursor, intro) : null
    return {
      lang: state.voice?.lang ?? state.book?.language ?? 'en',
      rate: state.rate,
      voice: state.voice as SpeechSynthesisVoice | null,
      ...(ref ? { cloud: { ref, upcoming: upcomingRef(), model: state.cloudModel ?? '' } } : {}),
      ...(localOn() ? { local: { upcoming: upcomingTexts(2) } } : {}),
    }
  }

  const pause = (patch: Partial<ReadAloudState> = {}) => {
    stopSpeaking()
    save()
    emit({ status: 'paused', ...patch })
  }

  const choiceKey = () =>
    state.book ? voiceChoiceKey(primarySubtag(state.book.language), isPrivateBookSlug(state.book.slug)) : null

  const hasCloudChoice = () => Object.values(readVoices(deps.storage)).some((uri) => uri.startsWith(CLOUD_VOICE_PREFIX))

  const failWith = (session_: number, error: string, retryAt?: Date, wasIntro = false) => {
    if (session_ !== session) return
    if (error === 'not_found') {
      close({ kind: 'unavailable' })
      return
    }
    if (isLocalProblem(error)) {
      failures = 0
      pause({ problem: { kind: 'local', code: error } })
      if (error === 'local_missing') void refreshLocal(session_)
      return
    }
    if (!isCloudProblem(error)) {
      fail(session_, wasIntro)
      return
    }
    if (error === 'voice_gone' && state.voice) {
      const key = choiceKey()
      if (key) forgetVoice(deps.storage, key, state.voice.voiceURI)
    }
    failures = 0
    pause({ problem: { kind: 'cloud', code: error, ...(retryAt ? { retryAt: retryAt.getTime() } : {}) } })
  }

  const fail = (session_: number, wasIntro = false) => {
    if (session_ !== session) return
    failures++
    if (failures >= MAX_FAILURES) {
      failures = 0
      pause({ problem: { kind: 'voice-failed' } })
      return
    }
    if (!wasIntro) advance()
    else if (stopAfter) finishForSleep()
    else speakNow()
  }

  const speakNow = () => {
    if (!current || !cursor) return
    const mine = session
    const chapter = current.data.chapter
    if (onLastPage(current.plan, cursor) && hasNextChapter(chapter)) void getChapter(chapter.index + 1)
    if (!cloudOn()) deps.cloudSpeaker?.stop()
    if (!localOn()) deps.localSpeaker?.stop()
    if (cloudOn() || localOn()) deps.speaker.stop()
    if (intro) {
      emit({ status: 'playing', problem: null })
      speaker().speak(chapterIntro(chapter), options(), {
        onEnd: () => {
          if (mine !== session) return
          failures = 0
          intro = false
          if (stopAfter) return finishForSleep()
          speakNow()
        },
        onError: (error, retryAt) => {
          if (mine !== session) return
          const passOver = !isCloudProblem(error) && !isLocalProblem(error) && error !== 'not_found'
          if (passOver) intro = false
          failWith(mine, error, retryAt, passOver)
        },
      })
      return
    }
    const u = utteranceAt(current.plan, cursor)
    if (!u) return
    emit({ status: 'playing', problem: null })
    if (now() - lastSave >= SAVE_EVERY_MS) save()
    speaker().speak(u.say, options(), {
      onEnd: () => {
        if (mine !== session) return
        failures = 0
        advance()
      },
      onError: (error, retryAt) => failWith(mine, error, retryAt),
    })
  }

  const finishForSleep = () => {
    stopAfter = false
    pause()
    deps.arbiter.readAloudSlept()
  }

  const advance = () => {
    if (!current || !cursor) return
    if (stopAfter) return finishForSleep()
    const following = next(current.plan, cursor)
    if (following) {
      cursor = following
      speakNow()
      return
    }
    const chapter = current.data.chapter
    if (!hasNextChapter(chapter)) {
      stopSpeaking()
      if (slug) {
        finishPosition(deps.storage, slug, now())
        deps.onSaved?.(slug, null)
      }
      emit({ status: 'ended', problem: { kind: 'end-of-book' } })
      return
    }
    if (deps.arbiter.partEnded() === 'stop') {
      void goToChapter(chapter.index + 1, { at: 'start', play: false })
      return
    }
    void goToChapter(chapter.index + 1, { at: 'start', play: true })
  }

  const goToChapter = async (
    index: number,
    to: { at: 'start' | { pageIndex: number; offset: number }; play: boolean; noIntro?: boolean },
  ) => {
    const mine = session
    stopSpeaking()
    emit({ status: 'loading', problem: null })
    const result = await getChapter(index)
    if (mine !== session) return
    if (!result.ok) {
      if (result.reason === 'not-found') {
        close({ kind: 'unavailable' })
        return
      }
      retryAction = () => void goToChapter(index, to)
      emit({ status: 'error', problem: { kind: 'load-failed' } })
      return
    }
    const plan = planChapter(result.data.chapter, result.data.book.language)
    current = { data: result.data, plan }
    const start = first(plan)
    cursor = to.at === 'start' ? start : (atOffset(plan, to.at.pageIndex, to.at.offset) ?? start)
    if (!cursor) {
      if (index + 1 < result.data.chapter.chapterCount) return goToChapter(index + 1, to)
      emit({ status: 'ended', problem: { kind: 'end-of-book' } })
      return
    }
    intro = !to.noIntro && sameCursor(cursor, start)
    emit({
      book: result.data.book,
      chapter: {
        index: result.data.chapter.index,
        slug: result.data.chapter.slug,
        title: result.data.chapter.title,
        number: result.data.chapter.number,
        chapterCount: result.data.chapter.chapterCount,
      },
    })
    if (to.play) speakNow()
    else {
      save()
      emit({ status: 'paused' })
    }
  }

  const close = (problem: Problem | null = null) => {
    const wasOpen = slug !== null
    save()
    deps.speaker.stop()
    deps.cloudSpeaker?.close()
    deps.localSpeaker?.close()
    cloudList = null
    session++
    slug = null
    chapters = new Map()
    current = null
    cursor = null
    intro = false
    stopAfter = false
    retryAction = null
    failures = 0
    state = { ...closed(), rate: state.rate, problem }
    publish()
    if (wasOpen) deps.arbiter.closed()
  }

  const cloudVoicesFor = (book: string): Promise<SpeechVoicesState> => {
    if (!deps.cloudSpeaker || !deps.loadCloudVoices) return Promise.resolve({ state: 'signed_out' })
    if (cloudList?.book !== book) {
      const answer = deps.loadCloudVoices(book).catch((): SpeechVoicesState => ({ state: 'unavailable' }))
      const entry = { book, answer }
      cloudList = entry
      void answer.then((a) => {
        if (a.state !== 'ready' && cloudList === entry) cloudList = null
      })
    }
    return cloudList.answer
  }

  const showCloudVoices = (mine: number, answer: SpeechVoicesState, lang: string) => {
    if (mine !== session) return
    state = {
      ...state,
      cloudVoices: cloudVoicesOf(answer, lang),
      cloudModel: answer.state === 'ready' ? answer.model : state.cloudModel,
    }
  }

  const start = (book: string, at: StartAt) => {
    deps.arbiter.beforeReadAloud()
    const same =
      slug === book
        ? { book: state.book, chapter: state.chapter, cloudVoices: state.cloudVoices, cloudModel: state.cloudModel }
        : {}
    if (slug !== book) chapters = new Map()
    if (deps.cloudSpeaker && (isCloudVoice(state.voice) || hasCloudChoice())) deps.cloudSpeaker.prime()
    else deps.localSpeaker?.prime()
    stopSpeaking()
    session++
    const mine = session
    slug = book
    current = null
    cursor = null
    failures = 0
    stopAfter = false
    retryAction = null
    lastSave = Number.NEGATIVE_INFINITY
    const loading = deps.cloudSpeaker && deps.loadCloudVoices ? ({ cloudVoices: 'loading' } as const) : {}
    state = { ...closed(), ...loading, ...same, rate: state.rate, following: true, status: 'loading' }
    publish()
    const saved = readPosition(deps.storage, book)
    const chapter = at.kind === 'saved' ? (saved?.chapter ?? 0) : at.chapter
    const position = at.kind === 'saved' ? (saved?.position ?? null) : at.position
    const cloud = cloudVoicesFor(book)
    void (async () => {
      const [voices, result, downloaded] = await Promise.all([
        deps.loadVoices(),
        getChapter(chapter),
        downloadedVoices(),
      ])
      if (mine !== session) return
      if (!result.ok) {
        close(result.reason === 'not-found' ? { kind: 'unavailable' } : { kind: 'load-failed' })
        return
      }
      const language = result.data.book.language
      const privateBook = isPrivateBookSlug(book)
      const resolved = resolveVoice({
        voices,
        downloaded: deps.localSpeaker ? downloaded : [],
        lang: language,
        privateBook,
        locale: deps.locale,
        storage: deps.storage,
      })
      if (voices.length > 0 && resolved.device.length === 0 && resolved.folio.length === 0) {
        close({ kind: 'no-voice', language: languageName(language) })
        return
      }
      const { cloudChoice } = resolved
      let voice = resolved.voice
      if (cloudChoice && deps.cloudSpeaker) {
        const answer = await cloud
        if (mine !== session) return
        showCloudVoices(mine, answer, language)
        const list = state.cloudVoices
        voice = (Array.isArray(list) ? list.find((v) => v.voiceURI === cloudChoice) : undefined) ?? voice
      } else {
        void cloud.then((answer) => {
          showCloudVoices(mine, answer, language)
          if (mine === session) emit()
        })
      }
      state = {
        ...state,
        voices: resolved.device,
        voice,
        engine: engineOf(voice),
        local: localStateFor(language, downloaded),
      }
      if (downloaded.length > 0) void deps.voiceStore?.ensureEngine().catch(() => {})
      const pages = result.data.chapter.pages
      const pageIndex = position ? pages.findIndex((p) => samePosition(p.position, position)) : -1
      const page = pages[pageIndex]
      const savedHere =
        saved !== null && saved.chapter === chapter && page !== undefined && samePosition(saved.position, page.position)
      const resume = savedHere ? saved.offset : 0
      const offset = at.kind === 'offset' ? at.offset : resume
      await goToChapter(chapter, {
        at: page ? { pageIndex, offset } : 'start',
        play: true,
        noIntro: at.kind === 'offset',
      })
    })()
  }

  const restartIfPlaying = () => {
    if (state.status === 'playing') speakNow()
    else emit()
  }

  const moveTo = (to: Cursor | null) => {
    if (!to) return
    cursor = to
    intro = false
    if (state.status === 'playing') speakNow()
    else {
      save()
      emit()
    }
  }

  return {
    start,
    toggle: () => {
      if (!slug || state.status === 'loading') return
      if (state.status === 'playing') {
        pause()
        return
      }
      if (state.problem?.kind === 'load-failed') {
        retryAction?.()
        return
      }
      if (state.status === 'ended') {
        void goToChapter(0, { at: 'start', play: true })
        return
      }
      failures = 0
      if (cloudOn()) deps.cloudSpeaker?.prime()
      if (localOn()) deps.localSpeaker?.prime()
      speakNow()
    },
    pause: () => {
      if (state.status === 'playing') pause()
    },
    nextSentence: () => {
      if (!current || !cursor) return
      if (intro) {
        intro = false
        restartIfPlaying()
        return
      }
      const to = next(current.plan, cursor)
      const chapter = current.data.chapter
      if (to) moveTo(to)
      else if (hasNextChapter(chapter))
        void goToChapter(chapter.index + 1, { at: 'start', play: state.status === 'playing' })
    },
    prevSentence: () => {
      if (!current || !cursor) return
      const to = prev(current.plan, cursor)
      if (to) moveTo(to)
      else restartIfPlaying()
    },
    nextChapter: () => {
      const chapter = current?.data.chapter
      if (chapter && hasNextChapter(chapter)) void goToChapter(chapter.index + 1, { at: 'start', play: true })
    },
    prevChapter: () => {
      const chapter = current?.data.chapter
      if (chapter && chapter.index > 0) void goToChapter(chapter.index - 1, { at: 'start', play: true })
    },
    toChapter: (index) => {
      const chapter = current?.data.chapter
      if (!chapter || !Number.isFinite(index)) return
      const to = Math.max(0, Math.min(chapter.chapterCount - 1, Math.trunc(index)))
      void goToChapter(to, { at: 'start', play: true })
    },
    seekFraction: (f) => {
      if (current) moveTo(atFraction(current.plan, f))
    },
    setRate: (rate) => {
      writeSpeed(deps.storage, rate)
      state = { ...state, rate }
      restartIfPlaying()
    },
    setVoice: (voiceURI) => {
      const cloud = Array.isArray(state.cloudVoices) ? state.cloudVoices : []
      const local = state.local.voices.filter((v) => v.state === 'ready').map((v) => v.voice)
      const voice = [...local, ...state.voices, ...cloud].find((v) => v.voiceURI === voiceURI)
      const key = choiceKey()
      if (!voice || !key) return
      rememberVoice(deps.storage, key, voiceURI)
      if (isCloudVoice(voice)) deps.cloudSpeaker?.prime()
      if (isLocalVoice(voice)) deps.localSpeaker?.prime()
      state = { ...state, voice, engine: engineOf(voice) }
      if (state.problem?.kind === 'cloud' || state.problem?.kind === 'local') state = { ...state, problem: null }
      restartIfPlaying()
    },
    useDeviceVoice: () => {
      const voice = pickVoice(state.voices, undefined)
      state = { ...state, voice, engine: 'device', problem: null }
      failures = 0
      if (current && cursor) speakNow()
      else emit()
    },
    retryCloudVoices: () => {
      const book = slug
      const language = state.book?.language
      if (!book || !language || (state.cloudVoices !== 'failed' && state.cloudVoices !== 'permission')) return
      const mine = session
      emit({ cloudVoices: 'loading' })
      void cloudVoicesFor(book).then((answer) => {
        showCloudVoices(mine, answer, language)
        if (mine === session) emit()
      })
    },
    downloadLocal: (id) => {
      const store = deps.voiceStore
      const entry = state.local.voices.find((v) => v.id === id)
      const folio = folioVoicesFor(state.book?.language ?? '', deps.locale).find((v) => v.id === id)
      if (!store || !entry || !folio || entry.state !== 'absent' || download) return
      const mine = { id, percent: 0, controller: new AbortController() }
      download = mine
      const show = () => {
        if (!state.book?.language) return
        state = {
          ...state,
          local: {
            ...state.local,
            offer: false,
            voices: state.local.voices.map((v) =>
              v.id === id ? { ...v, state: 'downloading', percent: mine.percent } : v,
            ),
          },
        }
        emit()
      }
      show()
      void store
        .download(
          folio,
          (percent) => {
            if (download !== mine || percent === mine.percent) return
            mine.percent = percent
            if (state.local.voices.some((v) => v.id === id)) show()
          },
          mine.controller.signal,
        )
        .then(async (outcome) => {
          download = null
          const like = folioVoiceLike(folio)
          if (outcome === 'ok') {
            const base = primarySubtag(state.book?.language ?? folio.lang)
            rememberVoice(deps.storage, voiceChoiceKey(base, false), like.voiceURI)
            rememberVoice(deps.storage, voiceChoiceKey(base, true), like.voiceURI)
          }
          const downloaded = await downloadedVoices()
          const language = state.book?.language
          if (language && folioVoicesFor(language, deps.locale).some((v) => v.id === id)) {
            const patch: Partial<ReadAloudState> = { local: localStateFor(language, downloaded) }
            if (outcome === 'ok' && deps.localSpeaker) Object.assign(patch, { voice: like, engine: 'local' as const })
            if (outcome === 'ok' && state.problem?.kind === 'local') patch.problem = null
            emit(patch)
          }
          if (outcome === 'ok') deps.onNotice?.({ kind: 'ready' })
          else if (outcome === 'failed') deps.onNotice?.({ kind: 'failed' })
          else if (outcome === 'no_room') deps.onNotice?.({ kind: 'no_room', bytes: entry.bytes })
        })
    },
    cancelDownload: () => download?.controller.abort(),
    removeLocal: () => {
      const store = deps.voiceStore
      const language = state.book?.language
      if (!store || !language) return
      const mine = session
      const voices = folioVoicesFor(language, deps.locale)
      void store
        .remove(voices)
        .catch(() => {})
        .then(async () => {
          const key = choiceKey()
          const base = primarySubtag(language)
          for (const v of voices) {
            const uri = folioVoiceLike(v).voiceURI
            if (key) forgetVoice(deps.storage, key, uri)
            forgetVoice(deps.storage, voiceChoiceKey(base, false), uri)
            forgetVoice(deps.storage, voiceChoiceKey(base, true), uri)
          }
          if (mine !== session) return
          const downloaded = await downloadedVoices()
          if (mine !== session) return
          const wasLocal = isLocalVoice(state.voice)
          state = { ...state, local: localStateFor(language, downloaded) }
          if (wasLocal) {
            const voice = pickVoice(state.voices, undefined)
            state = {
              ...state,
              voice,
              engine: 'device',
              problem: state.problem?.kind === 'local' ? null : state.problem,
            }
            restartIfPlaying()
          } else emit()
        })
    },
    dismissOffer: () => {
      dismissOffer(deps.storage)
      emit({ local: { ...state.local, offer: false } })
    },
    noteSlow: () => {
      slow = true
      emit({ local: { ...state.local, slow: true } })
    },
    setFollowing: (following) => {
      if (state.following !== following) emit({ following })
    },
    stopAfterSentence: () => {
      if (state.status === 'playing') stopAfter = true
    },
    retry: () => retryAction?.(),
    close: () => close(),
    state: () => state,
  }
}
