import { describe, expect, it } from 'vitest'
import { FONT_FAMILIES } from '~/client/features/reader/prefs'
import { BOOT_SCRIPT } from '~/client/lib/boot-script'

function run(options: {
  local?: Record<string, string>
  session?: Record<string, string>
  systemDark?: boolean
  search?: string
}) {
  const attrs: Record<string, string> = {}
  const vars: Record<string, string> = {}
  const classes = new Set<string>()
  const el = {
    setAttribute: (k: string, v: string) => {
      attrs[k] = v
    },
    classList: {
      add: (c: string) => classes.add(c),
      toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
    },
    style: { setProperty: (k: string, v: string) => (vars[k] = v) },
  }
  const store = (data: Record<string, string> = {}) => ({
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v
    },
  })
  const local = store(options.local)
  const listeners: Record<string, (event: unknown) => void> = {}
  const win: { __folioInstallPrompt?: unknown } = {}
  new Function(
    'document',
    'localStorage',
    'sessionStorage',
    'matchMedia',
    'location',
    'addEventListener',
    'window',
    BOOT_SCRIPT,
  )(
    { documentElement: el },
    local,
    store(options.session),
    () => ({ matches: options.systemDark ?? false }),
    { search: options.search ?? '' },
    (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener
    },
    win,
  )
  return { attrs, vars, classes, local, listeners, win }
}

describe('BOOT_SCRIPT', () => {
  it('defaults to dark when nothing is saved, and the reader follows the site', () => {
    const { classes, attrs } = run({ systemDark: false })
    expect(classes.has('dark')).toBe(true)
    expect(attrs['data-reader-theme']).toBe('dark')
    expect(attrs['data-reader-ask']).toBe('closed')
  })

  it('keeps a saved light theme, and the reader follows it', () => {
    const { classes, attrs } = run({ local: { 'folio-theme': 'light' }, systemDark: true })
    expect(classes.has('dark')).toBe(false)
    expect(attrs['data-reader-theme']).toBe('light')
  })

  it('applies saved reader prefs as attributes and CSS variables', () => {
    const prefs = {
      theme: 'sepia',
      font: 'atkinson',
      fontSize: 23,
      leading: 'relaxed',
      measure: 'wide',
      layout: 'scroll',
      sidebarHidden: true,
      askOpen: true,
    }
    const { attrs, vars } = run({ local: { 'reader-prefs': JSON.stringify(prefs), 'folio-theme': 'light' } })
    expect(attrs['data-reader-theme']).toBe('sepia')
    expect(attrs['data-reader-sidebar']).toBe('hidden')
    expect(attrs['data-reader-ask']).toBe('open')
    expect(attrs['data-reader-layout']).toBe('scroll')
    expect(vars).toEqual({
      '--reader-font': FONT_FAMILIES.atkinson,
      '--reader-font-size': '23px',
      '--reader-leading': '2.15',
      '--reader-measure': '780px',
    })
  })

  it('survives corrupt storage, with the reader following the dark default', () => {
    const { attrs, vars } = run({ local: { 'reader-prefs': '{oops' } })
    expect(attrs['data-reader-theme']).toBe('dark')
    expect(vars['--reader-font']).toBe(FONT_FAMILIES.literata)
    expect(attrs['data-reader-layout']).toBe('pages')
  })

  it('is in page mode unless scroll was saved', () => {
    expect(run({}).attrs['data-reader-layout']).toBe('pages')
    expect(run({ local: { 'reader-prefs': '{"layout":"sideways"}' } }).attrs['data-reader-layout']).toBe('pages')
  })

  it('falls back to Literata for an unknown or inherited font name, as parsePrefs does', () => {
    for (const font of ['comic-sans', 'toString', 7, null]) {
      const { vars } = run({ local: { 'reader-prefs': JSON.stringify({ font }) } })
      expect(vars['--reader-font'], String(font)).toBe(FONT_FAMILIES.literata)
    }
    expect(run({}).vars['--reader-font']).toBe(FONT_FAMILIES.literata)
  })

  it('turns on embedded mode from ?iframe=true and remembers hideTopBar', () => {
    const { attrs, local } = run({ search: '?iframe=true&hideTopBar=true' })
    expect(attrs['data-embed']).toBe('on')
    expect(attrs['data-hide-top-bar']).toBe('on')
    expect(local.getItem('hideTopBar')).toBe('true')
  })

  it('catches beforeinstallprompt before hydration: no browser banner, and the event kept for the Install app row', () => {
    const { listeners, win } = run({})
    let prevented = false
    const event = { preventDefault: () => (prevented = true) }
    listeners.beforeinstallprompt?.(event)
    expect(prevented).toBe(true)
    expect(win.__folioInstallPrompt).toBe(event)
  })
})
