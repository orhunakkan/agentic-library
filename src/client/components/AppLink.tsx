import { useRouter } from '@tanstack/react-router'
import { type AnchorHTMLAttributes, forwardRef, type MouseEvent } from 'react'

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
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (rest.target && rest.target !== '_self') return
    e.preventDefault()
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
