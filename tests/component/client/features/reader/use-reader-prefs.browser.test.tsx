import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, PREFS_AT_KEY, PREFS_KEY, type ReaderPrefs } from '~/client/features/reader/prefs'
import { useReaderPrefs } from '~/client/features/reader/use-reader-prefs'
import type { SyncKind } from '~/client/features/sync/engine'
import { mountHook } from '../../../../support/client/mount'

/** Who listens for a sync's changes, so a test can bring one in as the sync engine would. */
const synced = vi.hoisted(() => ({ listeners: new Set<(kinds: readonly SyncKind[]) => void>() }))
vi.mock('~/client/features/sync/engine', () => ({
  onSynced: (listener: (kinds: readonly SyncKind[]) => void) => {
    synced.listeners.add(listener)
    return () => {
      synced.listeners.delete(listener)
    }
  },
}))

/** The queue of changes for the server; the test only checks what the hook puts on it. */
const outbox = vi.hoisted(() => ({ add: vi.fn() }))
vi.mock('~/client/features/sync/outbox', () => ({ syncOutbox: outbox }))

const root = document.documentElement

const sepiaPrefs: ReaderPrefs = {
  theme: 'sepia',
  font: 'atkinson',
  fontSize: 23,
  leading: 'relaxed',
  measure: 'wide',
  layout: 'scroll',
  sidebarHidden: true,
  askOpen: true,
}

const store = (prefs: ReaderPrefs) => localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))

const bringInSync = (kinds: readonly SyncKind[]) => {
  for (const listener of synced.listeners) listener(kinds)
}

/** What the hook stored, read back as the unknown it is. */
const storedPrefs = (): unknown => JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')

/** Takes the stored settings and what the hook put on the page away, before each test and after it. */
function clearPrefs() {
  localStorage.removeItem(PREFS_KEY)
  localStorage.removeItem(PREFS_AT_KEY)
  root.classList.remove('dark')
  for (const name of ['data-reader-theme', 'data-reader-sidebar', 'data-reader-ask', 'data-reader-layout'])
    root.removeAttribute(name)
  for (const name of ['--reader-font', '--reader-font-size', '--reader-leading', '--reader-measure'])
    root.style.removeProperty(name)
}

beforeEach(() => {
  clearPrefs()
  return clearPrefs
})

describe('useReaderPrefs', () => {
  it('starts from the defaults in the site’s own light or dark, when nothing is stored', async () => {
    const light = mountHook(useReaderPrefs, undefined)
    await vi.waitFor(() => expect(light.current[0]).toEqual(DEFAULT_PREFS))
    expect(root.getAttribute('data-reader-theme')).toBe('light')
    light.unmount()

    root.classList.add('dark')
    const dark = mountHook(useReaderPrefs, undefined)
    await vi.waitFor(() => expect(dark.current[0]).toEqual({ ...DEFAULT_PREFS, theme: 'dark' }))
    expect(root.getAttribute('data-reader-theme')).toBe('dark')
  })

  it('starts from the stored settings, and puts them on the page', async () => {
    store(sepiaPrefs)
    const hook = mountHook(useReaderPrefs, undefined)

    await vi.waitFor(() => expect(hook.current[0]).toEqual(sepiaPrefs))
    expect(root.getAttribute('data-reader-theme')).toBe('sepia')
    expect(root.getAttribute('data-reader-sidebar')).toBe('hidden')
    expect(root.getAttribute('data-reader-ask')).toBe('open')
    expect(root.getAttribute('data-reader-layout')).toBe('scroll')
    expect(root.style.getPropertyValue('--reader-font')).toContain('Atkinson Hyperlegible Next Variable')
    expect(root.style.getPropertyValue('--reader-font-size')).toBe('23px')
    expect(root.style.getPropertyValue('--reader-leading')).toBe('2.15')
    expect(root.style.getPropertyValue('--reader-measure')).toBe('780px')
  })

  it('shows, stores and applies a change, and sends a synced one to the server with its time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_750_000_000_000)
    const hook = mountHook(useReaderPrefs, undefined)
    await vi.waitFor(() => expect(hook.current[0]).toEqual(DEFAULT_PREFS))

    hook.current[1]({ theme: 'sepia' })

    await vi.waitFor(() => expect(hook.current[0].theme).toBe('sepia'))
    expect(root.getAttribute('data-reader-theme')).toBe('sepia')
    expect(storedPrefs()).toEqual({ ...DEFAULT_PREFS, theme: 'sepia' })
    expect(localStorage.getItem(PREFS_AT_KEY)).toBe('1750000000000')
    expect(outbox.add).toHaveBeenCalledExactlyOnceWith({
      values: { theme: 'sepia', font: 'literata', leading: 'normal', measure: 'normal' },
      at: 1_750_000_000_000,
    })
  })

  it('keeps a change this device alone uses off the server', async () => {
    const hook = mountHook(useReaderPrefs, undefined)
    await vi.waitFor(() => expect(hook.current[0]).toEqual(DEFAULT_PREFS))

    hook.current[1]({ fontSize: 25, sidebarHidden: true })

    await vi.waitFor(() => expect(hook.current[0]).toMatchObject({ fontSize: 25, sidebarHidden: true }))
    expect(root.style.getPropertyValue('--reader-font-size')).toBe('25px')
    expect(root.getAttribute('data-reader-sidebar')).toBe('hidden')
    expect(storedPrefs()).toMatchObject({ fontSize: 25 })
    expect(localStorage.getItem(PREFS_AT_KEY)).toBeNull()
    expect(outbox.add).not.toHaveBeenCalled()
  })

  it('reads the settings again when a sync brings new ones, and only then', async () => {
    const hook = mountHook(useReaderPrefs, undefined)
    await vi.waitFor(() => expect(hook.current[0]).toEqual(DEFAULT_PREFS))
    store(sepiaPrefs)

    bringInSync(['reading', 'listening'])
    expect(root.getAttribute('data-reader-theme')).toBe('light')

    bringInSync(['settings'])
    await vi.waitFor(() => expect(hook.current[0]).toEqual(sepiaPrefs))
    expect(root.getAttribute('data-reader-theme')).toBe('sepia')
  })

  it('stops listening for syncs when it unmounts', async () => {
    const hook = mountHook(useReaderPrefs, undefined)
    await vi.waitFor(() => expect(synced.listeners.size).toBe(1))

    hook.unmount()
    expect(synced.listeners.size).toBe(0)
  })
})
