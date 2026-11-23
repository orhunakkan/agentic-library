import { ImagePlus, LoaderCircle, X } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { BookCover } from '~/client/components/BookCover'
import { cn } from '~/client/lib/cn'
import type { CoverImage } from '~/shared/content/library'
import type { CoverStyle } from '~/shared/content/schema'

export const chooserButton =
  'inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[14.5px] font-semibold text-ink transition hover:border-accent-line hover:bg-panel disabled:cursor-not-allowed disabled:opacity-60'

export const IMAGE_PROBLEM_TEXT = {
  unreadable: 'That image couldn’t be read. Choose a JPEG, PNG or WebP image.',
  small: 'That image is too small. Choose one at least 64 pixels wide.',
} as const

export function ChooseImageButton({ onChoose, busy }: { onChoose: (file: File) => void; busy?: string | null }) {
  const id = useId()
  return (
    <span>
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="peer sr-only"
        disabled={Boolean(busy)}
        data-testid="cover-choose-image"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (file) onChoose(file)
        }}
      />
      <label
        htmlFor={id}
        className={cn(
          chooserButton,
          'cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        {busy ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : (
          <ImagePlus className="size-4" aria-hidden />
        )}
        {busy ?? 'Choose an image…'}
      </label>
    </span>
  )
}

export function CoverChooser({
  title,
  author,
  style,
  cover,
  sourceText,
  onChoose,
  onGenerated,
  busy,
  error,
  children,
}: {
  title: string
  author: string
  style: CoverStyle
  cover: CoverImage | null
  sourceText: ReactNode
  onChoose?: (file: File) => void
  onGenerated?: () => void
  busy?: string | null
  error?: string | null
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start gap-5">
      <BookCover
        title={title}
        author={author}
        cover={style}
        image={cover}
        className="w-[120px] shrink-0 rounded-lg shadow-[0_12px_28px_-14px_rgb(0_0_0/0.6)]"
      />
      <div className="min-w-0 flex-[1_1_220px]">
        <p className="text-[13px] text-muted">{sourceText}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {onChoose && <ChooseImageButton onChoose={onChoose} busy={busy} />}
          {onGenerated && cover && (
            <button
              type="button"
              className={chooserButton}
              onClick={onGenerated}
              disabled={Boolean(busy)}
              data-testid="cover-use-generated"
            >
              <X className="size-4" aria-hidden />
              Use the generated cover
            </button>
          )}
          {children}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-[14px] text-red-700 dark:text-red-300" data-testid="cover-error">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
