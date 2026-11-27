import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  COLOR_NAMES,
  DEFAULT_COLOR,
  HIGHLIGHT_COLORS,
  isHighlightColor,
  knownColor,
} from '~/shared/highlights/colors.ts'

const css = readFileSync('src/client/styles/app.css', 'utf8')
const THEMES = ['light', 'sepia', 'dark'] as const

type Rgb = [number, number, number]

function themeBlock(theme: string): string {
  const at = css.indexOf(`:root[data-reader-theme="${theme}"] {`)
  if (at < 0) throw new Error(`no ${theme} theme in app.css`)
  return css.slice(at, css.indexOf('}', at))
}

function token(block: string, name: string): Rgb {
  const m = new RegExp(`--${name}:\\s*(\\d+) (\\d+) (\\d+);`).exec(block)
  if (!m) throw new Error(`no --${name}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function alpha(color: string): number {
  const m = new RegExp(`::highlight\\(hl-${color}\\)\\s*\\{[^}]*rgb\\(var\\(--r-hl-${color}\\) / ([\\d.]+)\\)`).exec(
    css,
  )
  if (!m) throw new Error(`no ::highlight(hl-${color}) rule`)
  return Number(m[1])
}

function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const blend = (top: Rgb, bottom: Rgb, a: number): Rgb =>
  top.map((v, i) => v * a + (bottom[i] as number) * (1 - a)) as Rgb

describe('highlight colours', () => {
  it('lists four named colours with yellow the default, and falls back to it for unknown ones', () => {
    expect(HIGHLIGHT_COLORS).toEqual(['yellow', 'green', 'blue', 'pink'])
    expect(DEFAULT_COLOR).toBe('yellow')
    expect(Object.keys(COLOR_NAMES)).toEqual([...HIGHLIGHT_COLORS])
    expect(isHighlightColor('green')).toBe(true)
    expect(isHighlightColor('purple')).toBe(false)
    expect(knownColor('purple')).toBe('yellow')
    expect(knownColor('pink')).toBe('pink')
  })

  for (const theme of THEMES) {
    it(`keep reader ink at 4.5:1 or better in the ${theme} theme, and stay apart from each other`, () => {
      const block = themeBlock(theme)
      const paper = token(block, 'r-paper')
      const ink = token(block, 'r-ink')
      const backgrounds = HIGHLIGHT_COLORS.map((c) => blend(token(block, `r-hl-${c}`), paper, alpha(c)))
      for (const [i, bg] of backgrounds.entries()) {
        expect(contrast(ink, bg), `${theme} ${HIGHLIGHT_COLORS[i]}`).toBeGreaterThanOrEqual(4.5)
      }
      for (const [i, a] of backgrounds.entries()) {
        expect(
          Math.max(...a.map((v, k) => Math.abs(v - (paper[k] as number)))),
          `${theme} ${i} vs paper`,
        ).toBeGreaterThan(20)
        for (const b of backgrounds.slice(i + 1)) {
          expect(Math.max(...a.map((v, k) => Math.abs(v - (b[k] as number)))), `${theme} ${i}`).toBeGreaterThan(20)
        }
      }
    })
  }

  for (const theme of THEMES) {
    it(`keeps reader ink at 4.5:1 or better on the read-aloud mark in the ${theme} theme, visibly apart from the paper`, () => {
      const block = themeBlock(theme)
      const paper = token(block, 'r-paper')
      const m = /::highlight\(ra-sentence\)\s*\{[^}]*rgb\(var\(--r-speaking\) \/ ([\d.]+)\)/.exec(css)
      if (!m) throw new Error('no ::highlight(ra-sentence) rule')
      const background = blend(token(block, 'r-speaking'), paper, Number(m[1]))
      expect(contrast(token(block, 'r-ink'), background)).toBeGreaterThanOrEqual(4.5)
      expect(Math.max(...background.map((v, k) => Math.abs(v - (paper[k] as number))))).toBeGreaterThan(20)
    })
  }

  for (const theme of THEMES) {
    it(`keeps reader ink at 4.5:1 or better on an ElevenLabs voice's word in the ${theme} theme, apart from its sentence`, () => {
      const block = themeBlock(theme)
      const paper = token(block, 'r-paper')
      const alphaOf = (name: string) => {
        const m = new RegExp(`::highlight\\(${name}\\)\\s*\\{[^}]*rgb\\(var\\(--r-speaking\\) / ([\\d.]+)\\)`).exec(css)
        if (!m) throw new Error(`no ::highlight(${name}) rule`)
        return Number(m[1])
      }
      const sentence = blend(token(block, 'r-speaking'), paper, alphaOf('ra-sentence'))
      const word = blend(token(block, 'r-speaking'), sentence, alphaOf('ra-word'))
      expect(contrast(token(block, 'r-ink'), word)).toBeGreaterThanOrEqual(4.5)
      expect(Math.max(...word.map((v, k) => Math.abs(v - (sentence[k] as number))))).toBeGreaterThan(20)
    })
  }
})

describe('the home page preview tints', () => {
  const siteBlock = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`)
    if (at < 0) throw new Error(`no ${selector} block in app.css`)
    return css.slice(at, css.indexOf('}', at))
  }
  const utilityAlpha = (name: string, token: string) => {
    const m = new RegExp(`@utility ${name}\\s*\\{[^}]*rgb\\(var\\(--${token}\\) / ([\\d.]+)\\)`).exec(css)
    if (!m) throw new Error(`no @utility ${name}`)
    return Number(m[1])
  }

  for (const [theme, selector] of [
    ['light', ':root'],
    ['dark', '.dark'],
  ] as const) {
    it(`keep body ink at 4.5:1 or better in the ${theme} site theme, visibly apart from the surface`, () => {
      const block = siteBlock(selector)
      const surface = token(block, 'c-surface')
      const ink = token(block, 'c-body')
      for (const [utility, name] of [
        ['preview-highlight', 'c-preview-highlight'],
        ['preview-speaking', 'c-preview-speaking'],
      ] as const) {
        const background = blend(token(block, name), surface, utilityAlpha(utility, name))
        expect(contrast(ink, background), `${theme} ${utility}`).toBeGreaterThanOrEqual(4.5)
        expect(Math.max(...background.map((v, k) => Math.abs(v - (surface[k] as number))))).toBeGreaterThan(20)
      }
    })
  }

  it('use the reader’s own light and dark colours', () => {
    const pairs = [
      [':root', 'light'],
      ['.dark', 'dark'],
    ] as const
    for (const [selector, reader] of pairs) {
      const block = siteBlock(selector)
      expect(token(block, 'c-preview-highlight')).toEqual(token(themeBlock(reader), 'r-hl-yellow'))
      expect(token(block, 'c-preview-speaking')).toEqual(token(themeBlock(reader), 'r-speaking'))
    }
  })
})
