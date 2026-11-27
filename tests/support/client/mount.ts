import { createElement, type ReactNode, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { onTestFinished } from 'vitest'

/** A mounted tree, which a test may take off the page early to check what an unmount cleans up. */
export interface Mounted {
  unmount: () => void
}

/**
 * Renders `ui` into the real page of a browser-mode test with React's own `createRoot`, and removes it when the
 * test finishes. Query what it rendered through `page` from `vitest/browser`, by role and visible text.
 */
export function mount(ui: ReactNode): Mounted {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  flushSync(() => root.render(ui))
  let mounted = true
  const unmount = () => {
    if (!mounted) return
    mounted = false
    root.unmount()
    host.remove()
  }
  onTestFinished(unmount)
  return { unmount }
}

/** A hook rendered by `mountHook`: its latest result, a way to render it again with new props, and to unmount it. */
export interface MountedHook<P, R> extends Mounted {
  /** What the hook returned on its latest render. Read it in `vi.waitFor` or `expect.poll` for async changes. */
  readonly current: R
  /** Renders the hook again with `props`, at once. */
  rerender: (props: P) => void
}

interface Latest<P, R> {
  rendered: boolean
  result?: R
  setProps?: (props: P) => void
}

function HookHost<P, R>({ useHook, initial, latest }: { useHook: (props: P) => R; initial: P; latest: Latest<P, R> }) {
  const [props, setProps] = useState(initial)
  latest.setProps = setProps
  latest.result = useHook(props)
  latest.rendered = true
  return null
}

/**
 * The element that renders `useHook` with `props`, and a way to read it once it's mounted. Shared by `mountHook` and
 * `mountHookAt`, which put the element on the page in their own ways.
 */
export function hookElement<P, R>(
  useHook: (props: P) => R,
  props: NoInfer<P>,
): { element: ReactNode; handle: (mounted: Mounted) => MountedHook<P, R> } {
  const latest: Latest<P, R> = { rendered: false }
  return {
    element: createElement(HookHost<P, R>, { useHook, initial: props, latest }),
    handle: (mounted) => ({
      get current() {
        if (!latest.rendered) throw new Error('The hook has not rendered yet')
        return latest.result as R
      },
      rerender: (next) => flushSync(() => latest.setProps?.(next)),
      unmount: mounted.unmount,
    }),
  }
}

/**
 * Renders a React hook in a component of its own, with React's own APIs, and returns its latest result. `wrap` puts
 * providers around it, such as `ToastProvider`. For a hook that reads the router, use `mountHookAt` from `./router`.
 */
export function mountHook<P, R>(
  useHook: (props: P) => R,
  /** Typed from the hook alone, so a literal here doesn't narrow what `rerender` takes. */
  props: NoInfer<P>,
  wrap: (children: ReactNode) => ReactNode = (children) => children,
): MountedHook<P, R> {
  const { element, handle } = hookElement(useHook, props)
  return handle(mount(wrap(element)))
}
