import { Drawer } from '@base-ui/react/drawer'
import { X } from 'lucide-react'
import { cn } from '~/client/lib/cn'
import type { Footnote, Tone } from '~/shared/content/schema'
import { FootnoteBody } from './PagedContent'

export function BottomSheet({
  open,
  onOpenChange,
  tone,
  className,
  children,
  initialFocus,
  finalFocus,
  chrome = false,
  'data-testid': testId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tone: Tone
  className: string
  children: React.ReactNode
  initialFocus?: React.RefObject<HTMLElement | null>
  finalFocus?: () => HTMLElement | boolean | null
  chrome?: boolean
  'data-testid': string
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-[70] bg-black/25 transition-opacity duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Drawer.Viewport className="fixed inset-x-0 bottom-0 z-[71] flex justify-center">
          <Drawer.Popup
            data-tone={tone}
            data-chrome={chrome || undefined}
            data-testid={testId}
            initialFocus={initialFocus}
            finalFocus={finalFocus}
            className={cn(
              'w-full rounded-t-2xl border border-b-0 border-r-line text-r-ink shadow-[0_-20px_60px_-20px_rgba(9,13,27,.4)] outline-none [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-300 ease-[cubic-bezier(.32,.72,0,1)] data-ending-style:[transform:translateY(100%)] data-starting-style:[transform:translateY(100%)]',
              className,
            )}
          >
            {children}
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

export function FootnoteSheet({ tone, footnote, onClose }: { tone: Tone; footnote?: Footnote; onClose: () => void }) {
  return (
    <BottomSheet
      open={footnote !== undefined}
      onOpenChange={(open) => !open && onClose()}
      tone={tone}
      data-testid="reader-footnote-sheet"
      className="max-h-[40vh] max-w-[512px] overflow-y-auto bg-r-paper px-6 pt-3 pb-[calc(24px+env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-r-line" aria-hidden />
      <div className="mb-2 flex items-center justify-between">
        <Drawer.Title className="eyebrow text-r-muted">Footnote</Drawer.Title>
        <Drawer.Close
          data-testid="reader-footnote-close"
          aria-label="Close"
          className="grid size-11 place-items-center rounded-full transition hover:bg-r-line"
        >
          <X className="size-5" />
        </Drawer.Close>
      </div>
      <Drawer.Content className="prose-reader text-[0.9em]">
        {footnote && <FootnoteBody footnote={footnote} />}
      </Drawer.Content>
    </BottomSheet>
  )
}

export function AskSheet({
  open,
  onOpenChange,
  tone,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tone: Tone
  children: React.ReactNode
}) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      tone={tone}
      data-testid="reader-ask-sheet"
      className="flex h-[85dvh] max-w-[640px] flex-col overflow-hidden bg-r-page"
    >
      <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-r-line" aria-hidden />
      <div className="min-h-0 flex-1">{children}</div>
    </BottomSheet>
  )
}
