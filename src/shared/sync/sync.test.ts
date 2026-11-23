import { describe, expect, it } from 'vitest'
import { isNewer, itemKey, parseSyncedSettings } from './sync'

const settings = { theme: 'sepia', font: 'opendyslexic', leading: 'relaxed', measure: 'wide' }

describe('parseSyncedSettings', () => {
  it('accepts the four keys with their values', () => {
    expect(parseSyncedSettings(settings)).toEqual(settings)
  })

  it('refuses a missing key, an extra key, a wrong value and a non-object', () => {
    const { measure: _, ...missing } = settings
    expect(parseSyncedSettings(missing)).toBeNull()
    expect(parseSyncedSettings({ ...settings, fontSize: 19 })).toBeNull()
    expect(parseSyncedSettings({ ...settings, theme: 'blue' })).toBeNull()
    expect(parseSyncedSettings({ ...settings, font: 3 })).toBeNull()
    expect(parseSyncedSettings({ ...settings, leading: 'loose' })).toBeNull()
    expect(parseSyncedSettings({ ...settings, measure: null })).toBeNull()
    expect(parseSyncedSettings(null)).toBeNull()
    expect(parseSyncedSettings('light')).toBeNull()
    expect(parseSyncedSettings([])).toBeNull()
  })
})

describe('itemKey', () => {
  it('names each kind of item', () => {
    expect(itemKey({ book: 'emma', position: { chapter: 'chapter-1', page: 2 } })).toBe('r:emma')
    expect(itemKey({ book: 'emma', kind: 'episode', episode: 'ep:1' })).toBe('e:emma:ep:1')
    expect(itemKey({ book: 'emma', kind: 'voice' })).toBe('v:emma')
    expect(itemKey('settings')).toBe('settings')
    expect(itemKey({ id: 'a1b2', seconds: 30 })).toBe('t:a1b2')
  })
})

describe('isNewer', () => {
  it('is strictly newer, so a tie keeps what is there', () => {
    expect(isNewer(2, 1)).toBe(true)
    expect(isNewer(1, 1)).toBe(false)
    expect(isNewer(1, 2)).toBe(false)
  })
})
