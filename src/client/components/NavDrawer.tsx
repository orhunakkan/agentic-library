import { Drawer } from '@base-ui/react/drawer'
import { useRouterState } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { useEffect } from 'react'
import type { Viewer } from '~/server/auth'
import { type NavData, SidebarContent } from './AppSidebar'

export function NavDrawer({
  id,
  open,
  onOpenChange,
  nav,
  viewer,
}: {
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  nav: NavData
  viewer: Viewer | null
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const search = useRouterState({ select: (s) => s.location.searchStr })

  // biome-ignore lint/correctness/useExhaustiveDependencies: the location is the trigger, not a value used inside.
  useEffect(() => {
    onOpenChange(false)
  }, [pathname, search])

  const close = () => onOpenChange(false)
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} swipeDirection="left">
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-[3px] transition-opacity duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Drawer.Viewport className="pointer-events-none fixed inset-0 z-[71]">
          <Drawer.Popup
            id={id}
            className="pointer-events-auto relative flex h-full w-[min(86vw,320px)] flex-col overflow-y-auto border-r border-line-soft bg-inset px-4 py-6 text-ink shadow-[0_30px_60px_-30px_rgb(0_0_0/0.6)] outline-none [transform:translateX(var(--drawer-swipe-movement-x))] transition-transform duration-300 ease-[cubic-bezier(.32,.72,0,1)] data-ending-style:[transform:translateX(-100%)] data-starting-style:[transform:translateX(-100%)]"
          >
            <Drawer.Title className="sr-only">Menu</Drawer.Title>
            <Drawer.Close
              aria-label="Close menu"
              data-testid="nav-menu-close"
              className="absolute top-6 right-3 z-10 grid size-11 place-items-center rounded-full text-body transition hover:bg-panel hover:text-ink"
            >
              <X className="size-5" aria-hidden />
            </Drawer.Close>
            <SidebarContent nav={nav} viewer={viewer} onNavigate={close} />
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
