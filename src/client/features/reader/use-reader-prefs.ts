import { useCallback, useEffect, useState } from 'react'
import { onSynced } from '~/client/features/sync/engine'
import { syncOutbox } from '~/client/features/sync/outbox'
import {
  changesSynced,
  DEFAULT_PREFS,
  FONT_FAMILIES,
  LEADING_VALUES,
  MEASURE_VALUES,
  PREFS_AT_KEY,
  PREFS_KEY,
  parsePrefs,
  pickSynced,
  type ReaderPrefs,
} from './prefs'

function applyPrefs(prefs: ReaderPrefs) {
  const root = document.documentElement
  root.setAttribute('data-reader-theme', prefs.theme)
  root.setAttribute('data-reader-sidebar', prefs.sidebarHidden ? 'hidden' : 'shown')
  root.setAttribute('data-reader-ask', prefs.askOpen ? 'open' : 'closed')
  root.setAttribute('data-reader-layout', prefs.layout)
  root.style.setProperty('--reader-font', FONT_FAMILIES[prefs.font])
  root.style.setProperty('--reader-font-size', `${prefs.fontSize}px`)
  root.style.setProperty('--reader-leading', String(LEADING_VALUES[prefs.leading]))
  root.style.setProperty('--reader-measure', `${MEASURE_VALUES[prefs.measure]}px`)
}

export function useReaderPrefs() {
  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_PREFS)

  useEffect(() => {
    const load = () => {
      let raw: string | null = null
      try {
        raw = localStorage.getItem(PREFS_KEY)
      } catch {}
      const stored = parsePrefs(raw, document.documentElement.classList.contains('dark'))
      applyPrefs(stored)
      setPrefs(stored)
    }
    load()
    return onSynced((kinds) => {
      if (kinds.includes('settings')) load()
    })
  }, [])

  const update = useCallback((patch: Partial<ReaderPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch }
      applyPrefs(next)
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {}
      if (changesSynced(patch, current)) {
        const at = Date.now()
        try {
          localStorage.setItem(PREFS_AT_KEY, String(at))
        } catch {}
        syncOutbox.add({ values: pickSynced(next), at })
      }
      return next
    })
  }, [])

  return [prefs, update] as const
}
