import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '~/client/lib/cn'
import { renderCoverSvg } from '~/shared/content/cover'
import type { CoverImage } from '~/shared/content/library'
import type { CoverStyle } from '~/shared/content/schema'

interface Props {
  title: string
  author: string
  cover: CoverStyle
  image?: CoverImage | null
  priority?: boolean
  className?: string
  transitionName?: string
}

export function BookCover({ title, author, cover, image, priority, className, transitionName }: Props) {
  const [failed, setFailed] = useState(false)
  const img = useRef<HTMLImageElement>(null)
  const src = image?.src

  useEffect(() => {
    const el = img.current
    setFailed(Boolean(src && el?.complete && el.naturalWidth === 0))
  }, [src])

  const svg = useMemo(
    () => renderCoverSvg({ title, author, cover }, { fontFamily: "'Literata Variable', Georgia, serif" }),
    [title, author, cover],
  )
  const frame = cn('cover aspect-[2/3] overflow-hidden rounded-xl bg-surface', className)
  const style = transitionName ? { viewTransitionName: transitionName } : undefined

  if (image && !failed)
    return (
      <div aria-hidden="true" className={frame} style={style}>
        <img
          ref={img}
          src={image.src}
          alt=""
          width={image.width}
          height={image.height}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      </div>
    )
  return (
    <div
      aria-hidden="true"
      className={frame}
      style={style}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: generated from catalog data with escaping (content/cover.ts)
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
