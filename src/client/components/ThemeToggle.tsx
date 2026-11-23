import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PREFS_KEY } from '~/client/features/reader/prefs'
import { SITE_THEME_KEY } from '~/client/lib/boot-script'

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(true)
  useEffect(() => {
    const root = document.documentElement
    const sync = () => setDark(root.classList.contains('dark'))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const toggle = () => {
    const next = !dark
    const root = document.documentElement
    root.classList.toggle('dark', next)
    try {
      localStorage.setItem(SITE_THEME_KEY, next ? 'dark' : 'light')
      if (!localStorage.getItem(PREFS_KEY)) root.setAttribute('data-reader-theme', next ? 'dark' : 'light')
    } catch {}
    setDark(next)
  }

  const label = dark ? 'Light theme' : 'Dark theme'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={className}
      data-testid="theme-toggle"
    >
      {dark ? <Sun className="size-[18px]" aria-hidden /> : <Moon className="size-[18px]" aria-hidden />}
    </button>
  )
}
