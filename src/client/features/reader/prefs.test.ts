import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LEADINGS, MEASURES, READER_FONTS, READER_THEMES } from '~/shared/sync/sync'
import {
  changesSynced,
  DEFAULT_PREFS,
  FONT_FAMILIES,
  FONT_OPTIONS,
  FONT_SIZES,
  LAYOUT_OPTIONS,
  LEADING_OPTIONS,
  MEASURE_VALUES,
  parsePrefs,
  pickSynced,
  type ReaderPrefs,
  stepFontSize,
  THEME_OPTIONS,
  withSynced,
} from './prefs'

describe('parsePrefs', () => {
  it('uses defaults on first visit', () => {
    expect(parsePrefs(null, false)).toEqual(DEFAULT_PREFS)
  })

  it('starts in dark when the site is dark and nothing is saved', () => {
    expect(parsePrefs(null, true).theme).toBe('dark')
  })

  it('keeps a saved theme regardless of the site theme', () => {
    expect(parsePrefs(JSON.stringify({ ...DEFAULT_PREFS, theme: 'sepia' }), true).theme).toBe('sepia')
  })

  it('replaces invalid fields with defaults and ignores garbage', () => {
    expect(parsePrefs('{"theme":"neon","fontSize":18,"leading":"relaxed"}', false)).toEqual({
      ...DEFAULT_PREFS,
      leading: 'relaxed',
    })
    expect(parsePrefs('not json', false)).toEqual(DEFAULT_PREFS)
  })

  it('remembers whether the Ask panel was open, closed unless saved as true', () => {
    expect(DEFAULT_PREFS.askOpen).toBe(false)
    expect(parsePrefs('{"askOpen":true}', false).askOpen).toBe(true)
    expect(parsePrefs('{"askOpen":"yes"}', false).askOpen).toBe(false)
  })
})

describe('font', () => {
  it('is Literata unless another of the five was saved', () => {
    expect(DEFAULT_PREFS.font).toBe('literata')
    expect(parsePrefs('{"font":"opendyslexic"}', false).font).toBe('opendyslexic')
    expect(parsePrefs('{"font":"comic-sans"}', false).font).toBe('literata')
    expect(parsePrefs('{"font":3}', false).font).toBe('literata')
    expect(parsePrefs('{"font":"toString"}', false).font).toBe('literata')
  })

  it('offers the five fonts in order, each with a CSS stack', () => {
    expect(FONT_OPTIONS.map((f) => f.label)).toEqual([
      'Literata',
      'Source Serif',
      'Geist',
      'Atkinson Hyperlegible',
      'OpenDyslexic',
    ])
    for (const f of FONT_OPTIONS) expect(FONT_FAMILIES[f.value], f.value).toMatch(/^"[^"]+", /)
    expect(Object.keys(FONT_FAMILIES).sort()).toEqual(FONT_OPTIONS.map((f) => f.value).sort())
  })

  it('names each family as its package’s CSS does', () => {
    const files: Record<string, string> = {
      literata: '@fontsource-variable/literata/opsz.css',
      'source-serif': '@fontsource-variable/source-serif-4/opsz.css',
      geist: '@fontsource-variable/geist/wght.css',
      atkinson: '@fontsource-variable/atkinson-hyperlegible-next/wght.css',
      opendyslexic: '@fontsource/opendyslexic/400.css',
    }
    for (const f of FONT_OPTIONS) {
      const css = readFileSync(`node_modules/${files[f.value]}`, 'utf8')
      const family = /font-family: '([^']+)'/.exec(css)?.[1]
      expect(FONT_FAMILIES[f.value].startsWith(`"${family}"`), f.value).toBe(true)
    }
  })
})

describe('layout', () => {
  it('is pages unless scroll was saved', () => {
    expect(DEFAULT_PREFS.layout).toBe('pages')
    expect(parsePrefs('{"layout":"scroll"}', false).layout).toBe('scroll')
    expect(parsePrefs('{"layout":"columns"}', false).layout).toBe('pages')
    expect(parsePrefs('{"layout":true}', false).layout).toBe('pages')
  })

  it('offers Pages and Scroll', () => {
    expect(LAYOUT_OPTIONS).toEqual([
      { value: 'pages', label: 'Pages' },
      { value: 'scroll', label: 'Scroll' },
    ])
  })
})

describe('stepFontSize', () => {
  it('moves in 2px steps from 15 to 27', () => {
    expect(FONT_SIZES).toEqual([15, 17, 19, 21, 23, 25, 27])
    expect(stepFontSize(19, 1)).toBe(21)
    expect(stepFontSize(19, -1)).toBe(17)
  })

  it('stops at the bounds', () => {
    expect(stepFontSize(27, 1)).toBe(27)
    expect(stepFontSize(15, -1)).toBe(15)
  })
})

describe('THEME_OPTIONS', () => {
  const css = readFileSync('src/client/styles/app.css', 'utf8')
  const channels = (theme: string, token: string) => {
    const at = css.indexOf(`:root[data-reader-theme="${theme}"] {`)
    const block = css.slice(at, css.indexOf('}', at))
    const m = new RegExp(`--${token}: (\\d+) (\\d+) (\\d+);`).exec(block)
    return m ? `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}` : null
  }
  const hex = (swatch: string, prefix: string) =>
    swatch.includes(`${prefix}-white`)
      ? '#ffffff'
      : (new RegExp(`${prefix}-\\[(#[0-9a-f]{6})\\]`).exec(swatch)?.[1] ?? null)

  it('paints each tile in its theme’s paper and ink', () => {
    expect(THEME_OPTIONS.map((t) => t.value)).toEqual(['light', 'sepia', 'dark'])
    for (const t of THEME_OPTIONS) {
      expect(hex(t.swatch, 'bg'), t.value).toBe(channels(t.value, 'r-paper'))
      expect(hex(t.swatch, 'text'), t.value).toBe(channels(t.value, 'r-ink'))
    }
  })
})

describe('synced settings', () => {
  const device: ReaderPrefs = {
    ...DEFAULT_PREFS,
    fontSize: 23,
    layout: 'scroll',
    sidebarHidden: true,
    askOpen: true,
  }

  it('picks theme, font, line spacing and page width', () => {
    expect(pickSynced({ ...device, theme: 'sepia', font: 'geist', leading: 'compact', measure: 'wide' })).toEqual({
      theme: 'sepia',
      font: 'geist',
      leading: 'compact',
      measure: 'wide',
    })
  })

  it('takes the account’s four and keeps the device’s font size, layout and panel', () => {
    const next = withSynced(device, { theme: 'dark', font: 'atkinson', leading: 'relaxed', measure: 'narrow' })
    expect(next).toEqual({
      ...device,
      theme: 'dark',
      font: 'atkinson',
      leading: 'relaxed',
      measure: 'narrow',
    })
  })

  it('tells a change to a synced setting from one to the device’s own', () => {
    expect(changesSynced({ theme: 'dark' }, device)).toBe(true)
    expect(changesSynced({ theme: device.theme }, device)).toBe(false)
    expect(changesSynced({ fontSize: 15, layout: 'pages' }, device)).toBe(false)
  })

  it('offers exactly the shared lists’ values', () => {
    const sorted = (values: readonly string[]) => [...values].sort()
    expect(sorted(FONT_OPTIONS.map((o) => o.value))).toEqual(sorted(READER_FONTS))
    expect(sorted(THEME_OPTIONS.map((o) => o.value))).toEqual(sorted(READER_THEMES))
    expect(sorted(LEADING_OPTIONS.map((o) => o.value))).toEqual(sorted(LEADINGS))
    expect(sorted(Object.keys(MEASURE_VALUES))).toEqual(sorted(MEASURES))
  })
})
