import { X } from 'lucide-react'
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { isPlainClick } from '~/client/components/AppLink'
import { cn } from '~/client/lib/cn'

export interface OpenPicture {
  src: string
  alt: string
  caption: string
  link: HTMLAnchorElement
}

export function usePictureLinks(area: RefObject<HTMLElement | null>) {
  const [picture, setPicture] = useState<OpenPicture | null>(null)
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || !isPlainClick(event)) return
      const link = (event.target as Element | null)?.closest?.('[data-highlight-root] figure > a')
      const img = link?.querySelector('img')
      if (!(link instanceof HTMLAnchorElement) || !img || !area.current?.contains(link)) return
      event.preventDefault()
      setPicture({
        src: img.currentSrc || img.src,
        alt: img.alt,
        caption: link.parentElement?.querySelector('figcaption')?.textContent?.trim() ?? '',
        link,
      })
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [area])
  const close = useCallback(() => setPicture(null), [])
  return { picture, close }
}

export function PictureViewer({ picture, onClose }: { picture: OpenPicture | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const [actual, setActual] = useState(false)
  const [zoomable, setZoomable] = useState(false)

  useEffect(() => {
    const el = dialog.current
    if (!el || !picture) return
    setActual(false)
    setZoomable(false)
    if (!el.open) el.showModal()
    const link = picture.link
    return () => {
      if (el.open) el.close()
      if (link.isConnected) link.focus({ preventScroll: true })
    }
  }, [picture])

  const measure = useCallback(() => {
    const img = image.current
    if (img) setZoomable(img.naturalWidth > img.clientWidth + 1 || img.naturalHeight > img.clientHeight + 1)
  }, [])
  useEffect(() => {
    if (!picture) return
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [picture, measure])

  const label = picture?.caption || picture?.alt || 'Picture'
  return (
    <dialog
      ref={dialog}
      data-testid="reader-picture-viewer"
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
      }}
      className="picture-viewer fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-black/92 p-0 text-white backdrop:bg-transparent"
    >
      {picture && (
        // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop around the picture; Esc and Close are the keyboard's way out.
        <div
          className={cn(
            'flex h-full w-full flex-col items-center gap-3 p-4',
            actual ? 'overflow-auto' : 'justify-center overflow-hidden',
          )}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
          role="presentation"
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: zooming is a pointer convenience; the keyboard scrolls the actual size, and the picture is the file the link opens. */}
          <img
            ref={image}
            data-testid="reader-picture-image"
            src={picture.src}
            alt={picture.alt}
            onLoad={measure}
            onClick={() => {
              if (zoomable || actual) setActual(!actual)
            }}
            className={cn(
              'block shrink-0',
              actual ? 'max-w-none' : 'min-h-0 max-w-full shrink object-contain',
              actual ? 'cursor-zoom-out' : zoomable && 'cursor-zoom-in',
            )}
            style={actual ? undefined : { maxHeight: picture.caption ? 'calc(100% - 4.5rem)' : '100%' }}
          />
          {picture.caption && (
            <p className="max-h-[30vh] max-w-[40em] shrink-0 overflow-auto text-center font-sans text-[0.875rem] leading-relaxed text-white">
              {picture.caption}
            </p>
          )}
        </div>
      )}
      <button
        type="button"
        data-testid="reader-picture-close"
        aria-label="Close picture"
        onClick={onClose}
        className="fixed top-3 right-3 grid size-11 place-items-center rounded-full bg-black/60 text-white transition hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white"
      >
        <X className="size-5" aria-hidden />
      </button>
    </dialog>
  )
}
