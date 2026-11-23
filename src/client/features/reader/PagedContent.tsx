import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { cn } from '~/client/lib/cn'
import type { Block, Footnote, Inline } from '~/shared/content/schema'

interface Props {
  blocks: Block[]
  footnotes: Footnote[]
  onFootnote: (id: string) => void
  highlightRoot?: React.Ref<HTMLDivElement>
}

export function PagedContent({ blocks, footnotes, onFootnote, highlightRoot }: Props) {
  const [open, setOpen] = useState<{ key: string; meaning: string; left: number; top: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const tipId = useId()
  const footnotesId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.('[data-gloss]')) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
    }
    const onResize = () => setOpen(null)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  // biome-ignore lint/correctness/useExhaustiveDependencies: blocks identity changes per page.
  useEffect(() => setOpen(null), [blocks])

  const showGloss = (key: string, meaning: string, target: HTMLElement) => {
    if (open?.key === key) {
      setOpen(null)
      return
    }
    const root = rootRef.current?.getBoundingClientRect()
    if (!root) return
    const rect = target.getBoundingClientRect()
    const width = Math.min(280, root.width)
    const center = rect.left + rect.width / 2 - root.left
    setOpen({
      key,
      meaning,
      left: Math.max(0, Math.min(root.width - width, center - width / 2)),
      top: rect.bottom - root.top + 8,
    })
  }

  const renderInline = (inline: Inline, key: string): ReactNode => {
    if (inline.type === 'arabic') {
      return (
        <span key={key} lang="ar" dir="rtl" className="arabic">
          {inline.text}
        </span>
      )
    }
    if (inline.type === 'footnoteRef') {
      return (
        <button
          key={key}
          type="button"
          data-highlight-skip
          data-testid="reader-footnote-ref"
          data-key={inline.refId}
          onClick={() => onFootnote(inline.refId)}
          aria-label={`Footnote ${inline.text}`}
          className="mx-0.5 inline-grid min-w-[1.35em] -translate-y-[0.45em] place-items-center rounded-[5px] bg-r-accent/12 px-1 align-baseline font-sans text-[0.62em] leading-[1.5] font-semibold text-r-accent transition hover:bg-r-accent hover:text-r-paper"
        >
          {inline.text}
        </button>
      )
    }
    let node: ReactNode = inline.text
    if (inline.italic) node = <em>{node}</em>
    if (inline.bold) node = <strong>{node}</strong>
    if (inline.gloss) {
      const meaning = inline.gloss
      return (
        <button
          key={key}
          type="button"
          data-gloss
          data-testid="reader-gloss"
          data-key={key}
          aria-expanded={open?.key === key}
          aria-describedby={open?.key === key ? tipId : undefined}
          onClick={(e) => showGloss(key, meaning, e.currentTarget)}
          className="gloss inline p-0 text-inherit [font:inherit]"
        >
          {node}
        </button>
      )
    }
    return <span key={key}>{node}</span>
  }

  return (
    <div ref={rootRef} className="relative">
      <div ref={highlightRoot} data-highlight-root={highlightRoot ? '' : undefined}>
        {blocks.map((block) => {
          const children = block.content.map((inline, i) => renderInline(inline, `${block.id}:${i}`))
          if (block.type === 'heading') {
            const shallow = (block.depth ?? 2) <= 2
            const Tag = shallow ? 'h2' : 'h3'
            return (
              <Tag key={block.id} className={shallow ? 'text-[1.12em]' : 'text-[1em]'}>
                {children}
              </Tag>
            )
          }
          const onlyArabic = block.content.length > 0 && block.content.every((i) => i.type === 'arabic')
          return (
            <p
              key={block.id}
              className={cn(block.alignment === 'center' && 'center', onlyArabic && 'my-6 text-center')}
            >
              {children}
            </p>
          )
        })}
      </div>

      {open && (
        <div
          id={tipId}
          role="tooltip"
          data-testid="reader-gloss-meaning"
          className="absolute z-20 w-[min(280px,100%)] animate-[fade-in_150ms_ease-out] rounded-lg border border-r-line bg-r-paper px-4 py-3 font-reader text-[15px] leading-snug text-r-ink shadow-[0_18px_40px_-14px_rgba(18,28,58,.35)]"
          style={{ left: open.left, top: open.top }}
        >
          {open.meaning}
        </div>
      )}

      {footnotes.length > 0 && (
        <aside aria-labelledby={footnotesId} className="mt-10 border-t border-r-line pt-5">
          <h2 id={footnotesId} className="eyebrow mb-3 font-sans text-r-muted">
            Footnotes
          </h2>
          <ol className="space-y-1.5 font-sans text-[14px] leading-snug text-r-muted">
            {footnotes.map((fn, i) => (
              <li key={fn.id}>
                <button
                  type="button"
                  data-testid="reader-footnote"
                  data-key={fn.id}
                  onClick={() => onFootnote(fn.id)}
                  className="flex gap-2 text-left transition hover:text-r-ink"
                >
                  <span className="font-semibold text-r-accent">{i + 1}.</span>
                  <span className="line-clamp-2">{fn.content.map((c) => c.text).join('')}</span>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </div>
  )
}

export function FootnoteBody({ footnote }: { footnote: Footnote }) {
  return (
    <PagedContent
      blocks={[{ id: `${footnote.id}-body`, type: 'paragraph', alignment: 'justify', content: footnote.content }]}
      footnotes={[]}
      onFootnote={() => {}}
    />
  )
}
