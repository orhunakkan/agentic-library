import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { onTestFinished } from 'vitest'

/**
 * Renders `ui` into the real page of a browser-mode test with React's own `createRoot`, and removes it when the
 * test finishes. Query what it rendered through `page` from `vitest/browser`, by role and visible text.
 */
export function mount(ui: ReactNode): void {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  flushSync(() => root.render(ui))
  onTestFinished(() => {
    root.unmount()
    host.remove()
  })
}
