import { useRouter } from '@tanstack/react-router'
import { type AnchorHTMLAttributes, forwardRef, type MouseEvent } from 'react'

/** A main-button click with no modifier keys, which the page may handle; modified clicks stay the browser's. */
export const isPlainClick = (e: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string
  viewTransition?: boolean
  preload?: boolean
  'data-testid': string
}

export const AppLink = forwardRef<HTMLAnchorElement, Props>(function AppLink(
  { href, viewTransition, preload = true, onClick, onMouseEnter, onFocus, ...rest },
  ref,
) {
  const router = useRouter()
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || !isPlainClick(event)) return
    if (rest.target && rest.target !== '_self') return
    event.preventDefault()
    void router.navigate({ href, viewTransition })
  }
  const warm = () => {
    if (preload) void router.preloadRoute({ href } as never).catch(() => {})
  }
  return (
    <a
      ref={ref}
      href={href}
      onClick={handleClick}
      onMouseEnter={(e) => {
        onMouseEnter?.(e)
        warm()
      }}
      onFocus={(e) => {
        onFocus?.(e)
        warm()
      }}
      {...rest}
    />
  )
})
