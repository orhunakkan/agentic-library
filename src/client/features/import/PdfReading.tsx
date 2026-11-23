import { LoaderCircle } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '~/client/features/account/ui'
import { shownStyles } from '~/shared/import/pdf/styles'
import type { PdfLayoutReport, PdfOverrides, PdfStyle, StyleKind } from '~/shared/import/pdf/types'
import {
  bodyOf,
  chapterSource,
  fontText,
  KIND_LABELS,
  kindOf,
  readingSummary,
  sampleScale,
  shareText,
  withKind,
} from './pdf-reading'

const REREAD_WARNING = 'Reading the PDF again undoes your chapter changes.'

export interface PdfReadingProps {
  styles: readonly PdfStyle[]
  report: PdfLayoutReport
  overrides: PdfOverrides
  edited: boolean
  rereading: boolean
  disabled: boolean
  onReread: (overrides: PdfOverrides) => void
}

export function PdfReading({ styles, report, overrides, edited, rereading, disabled, onReread }: PdfReadingProps) {
  const id = useId()
  const [pending, setPending] = useState<PdfOverrides | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const shown = shownStyles(styles)
  const body = bodyOf(styles)

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (pending && !el.open) el.showModal()
    if (!pending && el.open) el.close()
  }, [pending])

  const change = (next: PdfOverrides) => {
    if (edited) setPending(next)
    else onReread(next)
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      aria-busy={rereading || undefined}
      className="relative rounded-xl border border-line p-4 sm:p-5"
      data-testid="pdf-reading"
    >
      <h4 id={`${id}-title`} className="text-[16px] font-semibold text-ink">
        How the PDF was read
      </h4>
      <p className="mt-1 text-[13.5px] leading-relaxed text-muted" data-testid="pdf-summary">
        {readingSummary(report)}
      </p>

      <fieldset disabled={disabled || rereading} className="mt-4 min-w-0 space-y-4">
        <legend className="sr-only">Corrections</legend>
        {report.hasOutline && (
          <div
            role="radiogroup"
            aria-labelledby={`${id}-from`}
            className="flex flex-wrap items-center gap-x-4 gap-y-2"
            data-testid="pdf-chapters-from"
          >
            <span id={`${id}-from`} className="text-[14px] font-medium text-ink">
              Chapters from:
            </span>
            {(
              [
                ['outline', 'The PDF’s bookmarks'],
                ['headings', 'The headings'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="inline-flex min-h-11 items-center gap-2 text-[14px] text-ink">
                <input
                  type="radio"
                  name={`${id}-chapters`}
                  value={value}
                  checked={chapterSource(report) === value}
                  onChange={() => change({ ...overrides, chapters: value })}
                  className="size-4 accent-accent"
                  data-testid="pdf-chapters-source"
                  data-key={value}
                />
                {label}
              </label>
            ))}
          </div>
        )}

        <div>
          <p id={`${id}-styles`} className="text-[14px] font-medium text-ink">
            Text styles
          </p>
          <table aria-labelledby={`${id}-styles`} className="mt-2 block w-full text-left text-[13.5px] sm:table">
            <thead className="sr-only sm:not-sr-only sm:table-header-group">
              <tr className="text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Sample
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Font
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Share
                </th>
                <th scope="col" className="py-2 font-medium">
                  Read as
                </th>
              </tr>
            </thead>
            <tbody className="block divide-y divide-line sm:table-row-group">
              {shown.map((style) => {
                const selectId = `${id}-${style.key}`
                return (
                  <tr
                    key={style.key}
                    className="block py-3 sm:table-row sm:py-0"
                    data-testid="pdf-style"
                    data-key={style.key}
                  >
                    <td className="block max-w-full truncate sm:table-cell sm:max-w-[22ch] sm:py-2 sm:pr-3">
                      <span
                        className="text-ink"
                        style={{ fontFamily: 'var(--font-reader)', fontSize: `${sampleScale(style, body)}em` }}
                      >
                        {style.sample}
                      </span>
                    </td>
                    <td className="inline sm:table-cell sm:py-2 sm:pr-3 text-muted">{fontText(style)}</td>
                    <td className="inline pl-2 sm:table-cell sm:py-2 sm:pr-3 sm:pl-0 text-muted tabular">
                      <span className="sm:hidden" aria-hidden>
                        ·{' '}
                      </span>
                      {shareText(style, styles)}
                    </td>
                    <td className="mt-2 block sm:mt-0 sm:table-cell sm:py-2">
                      <label htmlFor={selectId} className="sr-only">
                        Read {fontText(style)} as
                      </label>
                      <select
                        id={selectId}
                        value={kindOf(style, overrides)}
                        onChange={(e) => change(withKind(overrides, style, e.target.value as StyleKind))}
                        className="h-11 w-full rounded-xl border border-line bg-page px-3 text-[15px] text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15 sm:w-auto"
                        data-testid="pdf-style-kind"
                        data-key={style.key}
                      >
                        {KIND_LABELS.map(({ kind, label }) => (
                          <option key={kind} value={kind}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </fieldset>

      {rereading && (
        <div className="absolute inset-0 grid place-items-center rounded-xl bg-surface/80">
          <p role="status" className="flex items-center gap-2 text-[15px] text-ink" data-testid="pdf-rereading">
            <LoaderCircle className="size-5 animate-spin" aria-hidden />
            Reading again…
          </p>
        </div>
      )}

      <dialog
        ref={dialog}
        aria-labelledby={`${id}-confirm`}
        data-testid="pdf-reread-dialog"
        onCancel={(e) => {
          e.preventDefault()
          setPending(null)
        }}
        className="m-auto max-w-[min(420px,calc(100vw-32px))] rounded-[22px] border border-line bg-surface p-6 text-ink backdrop:bg-black/40"
      >
        <p id={`${id}-confirm`} className="text-[15px] leading-relaxed">
          {REREAD_WARNING}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            type="button"
            data-testid="pdf-reread-confirm"
            onClick={() => {
              const next = pending
              setPending(null)
              if (next) onReread(next)
            }}
          >
            Read again
          </Button>
          <Button type="button" variant="secondary" onClick={() => setPending(null)} data-testid="pdf-reread-cancel">
            Cancel
          </Button>
        </div>
      </dialog>
    </section>
  )
}
