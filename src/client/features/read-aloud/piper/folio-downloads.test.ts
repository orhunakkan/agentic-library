import { describe, expect, it, vi } from 'vitest'
import { ENGINE_BYTES, FOLIO_VOICES, folioVoice } from '~/shared/read-aloud/folio-voices'
import { memoryStorage } from '../../../../../tests/fixtures/cache-storage'
import { createFolioDownloads } from './folio-downloads'
import type { DownloadOutcome, VoiceStore } from './voice-store'

const LJ = folioVoice('en_US-ljspeech-medium')
const CORI = folioVoice('en_GB-cori-medium')
if (!LJ || !CORI) throw new Error('both English voices are in the catalogue')

function setup(options: { downloaded?: string[]; storage?: Storage } = {}) {
  const downloaded = new Set(options.downloaded ?? [])
  const downloads: {
    id: string
    progress: (p: number) => void
    signal?: AbortSignal
    finish: (o: DownloadOutcome) => void
  }[] = []
  const store: VoiceStore = {
    status: async (v) => (downloaded.has(v.id) ? 'ready' : 'absent'),
    downloaded: async () => FOLIO_VOICES.filter((v) => downloaded.has(v.id)),
    download: (v, progress, signal) =>
      new Promise((resolve) => {
        downloads.push({
          id: v.id,
          progress,
          signal,
          finish: (o) => {
            if (o === 'ok') downloaded.add(v.id)
            resolve(o)
          },
        })
        signal?.addEventListener('abort', () => resolve('cancelled'))
      }),
    remove: vi.fn(async (voices) => {
      for (const v of voices) downloaded.delete(v.id)
    }),
    ensureEngine: async () => {},
    engineUrls: () => [],
  }
  const storage = options.storage ?? memoryStorage()
  const changes = { count: 0 }
  const folio = createFolioDownloads({
    voiceStore: store,
    storage,
    locale: 'en-US',
    onChange: () => void changes.count++,
  })
  return { folio, store, storage, downloads, changes }
}

describe('Folio downloads', () => {
  it('shows the language’s Folio voices, sized with the engine until one is downloaded, and offers them', async () => {
    const t = setup()
    expect(await t.folio.refresh()).toEqual([])
    const local = t.folio.local('en')
    expect(local.voices.map((v) => [v.id, v.state, v.bytes])).toEqual([
      [LJ.id, 'absent', LJ.bytes + ENGINE_BYTES],
      [CORI.id, 'absent', CORI.bytes + ENGINE_BYTES],
    ])
    expect(local).toMatchObject({ offer: true, slow: false, removable: 0 })
    expect(t.folio.local('xx').voices).toEqual([])
    expect(t.folio.local('xx').offer).toBe(false)
  })

  it('counts what can be removed, and stops offering once a voice is downloaded', async () => {
    const t = setup({ downloaded: [LJ.id] })
    expect(await t.folio.refresh()).toEqual([LJ])
    const local = t.folio.local('en')
    expect(local).toMatchObject({ offer: false, removable: LJ.bytes })
    expect(local.voices.find((v) => v.id === CORI.id)).toMatchObject({ state: 'absent', bytes: CORI.bytes })
  })

  it('reports progress, and finishes with the outcome and the size it offered', async () => {
    const t = setup()
    await t.folio.refresh()
    const finished = t.folio.download(LJ.id, 'en')
    expect(t.folio.local('en').offer).toBe(false)
    expect(t.downloads).toHaveLength(1)
    t.downloads[0]?.progress(45)
    expect(t.folio.local('en').voices[0]).toMatchObject({ state: 'downloading', percent: 45 })
    expect(t.changes.count).toBe(2)
    t.downloads[0]?.finish('ok')
    expect(await finished).toEqual({ voice: LJ, outcome: 'ok', bytes: LJ.bytes + ENGINE_BYTES })
    expect(t.folio.local('en').voices[0]).toMatchObject({ state: 'ready' })
  })

  it('runs one download at a time, and only of an absent voice of the language', async () => {
    const t = setup({ downloaded: [CORI.id] })
    await t.folio.refresh()
    expect(await t.folio.download(CORI.id, 'en')).toBeNull()
    expect(await t.folio.download(LJ.id, 'tr')).toBeNull()
    void t.folio.download(LJ.id, 'en')
    expect(await t.folio.download(LJ.id, 'en')).toBeNull()
    expect(t.downloads).toHaveLength(1)
  })

  it('cancels the download in flight, leaving the voice absent', async () => {
    const t = setup()
    await t.folio.refresh()
    const finished = t.folio.download(CORI.id, 'en')
    t.folio.cancel()
    expect(t.downloads[0]?.signal?.aborted).toBe(true)
    expect(await finished).toMatchObject({ outcome: 'cancelled' })
    expect(t.folio.local('en').voices[1]).toMatchObject({ state: 'absent', percent: 0 })
    expect(t.folio.local('en').offer).toBe(true)
  })

  it('brings the offer back when a download has no room or fails', async () => {
    for (const outcome of ['no_room', 'failed'] as const) {
      const t = setup()
      await t.folio.refresh()
      const finished = t.folio.download(LJ.id, 'en')
      t.downloads[0]?.finish(outcome)
      expect(await finished).toMatchObject({ outcome })
      expect(t.folio.local('en')).toMatchObject({ offer: true })
      expect(t.folio.local('en').voices[0]?.state).toBe('absent')
    }
  })

  it('removes the language’s voices through the store and offers them again', async () => {
    const t = setup({ downloaded: [LJ.id] })
    await t.folio.refresh()
    expect(await t.folio.remove('en')).toEqual([LJ, CORI])
    expect(t.store.remove).toHaveBeenCalledWith([LJ, CORI])
    expect(t.folio.local('en')).toMatchObject({ offer: true, removable: 0 })
  })

  it('still reports the removal when the store fails to remove', async () => {
    const t = setup({ downloaded: [LJ.id] })
    await t.folio.refresh()
    vi.mocked(t.store.remove).mockRejectedValueOnce(new Error('gone wrong'))
    expect(await t.folio.remove('en')).toEqual([LJ, CORI])
    expect(t.folio.local('en').removable).toBe(LJ.bytes)
  })

  it('keeps Not now across sessions', async () => {
    const t = setup()
    await t.folio.refresh()
    t.folio.dismissOffer()
    expect(t.folio.local('en').offer).toBe(false)
    expect(t.changes.count).toBe(1)
    const again = setup({ storage: t.storage })
    await again.folio.refresh()
    expect(again.folio.local('en').offer).toBe(false)
  })

  it('notes a slow device', () => {
    const t = setup()
    t.folio.noteSlow()
    expect(t.folio.local('en').slow).toBe(true)
    expect(t.changes.count).toBe(1)
  })
})
