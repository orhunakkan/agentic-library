import { Link } from '@tanstack/react-router'
import { CircleAlert, type LucideIcon, Play, RotateCcw, Square, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '~/client/lib/cn'
import type { RunLang } from '~/shared/run-code/langs'
import type { RunAccess } from './run-access'
import {
  COLUMNS_CUT,
  OUTPUT_EMPTY,
  ROWS_CUT,
  SIGNED_OUT_TEXT,
  shortcutText,
  statusText,
  TYPESCRIPT_NOTE,
  titleText,
} from './run-messages'
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, type ShownEntry } from './sandbox/output'
import { MAX_RUN_CODE, type OutputLevel } from './sandbox/protocol'
import { useRunner } from './use-runner'

export interface RunTarget {
  lang: RunLang
  code: string
  key: string
  opener: HTMLElement | null
}

export type RunEdits = Map<string, string>

export function useRunEdits(scope: string): RunEdits {
  const held = useRef<{ scope: string; edits: RunEdits }>({ scope, edits: new Map() })
  if (held.current.scope !== scope) held.current = { scope, edits: new Map() }
  return held.current.edits
}

const isMac = () =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform,
  )

function ReadOnlyCode({ code }: { code: string }) {
  return (
    <pre
      className="mt-4 max-h-[50vh] overflow-auto rounded-lg border border-line bg-inset p-3 font-mono text-[13.5px] leading-relaxed whitespace-pre text-ink"
      data-testid="run-code"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a region that scrolls must be reachable by keyboard.
      tabIndex={0}
    >
      {code}
    </pre>
  )
}

const MARKED_LEVELS: Partial<Record<OutputLevel, { Icon: LucideIcon; tone: string; label: string }>> = {
  error: { Icon: CircleAlert, tone: 'text-red-700 dark:text-red-300', label: 'Error: ' },
  warn: { Icon: TriangleAlert, tone: 'text-hue-amber-ink', label: 'Warning: ' },
}

function Entry({ entry }: { entry: ShownEntry }) {
  if (entry.t === 'table')
    return (
      <div className="my-1 max-w-full overflow-x-auto">
        <table className="border-collapse text-[12.5px]">
          <thead>
            <tr>
              {entry.columns.map((column, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a column's place is its identity.
                <th key={i} scope="col" className="border border-line bg-inset px-2 py-0.5 text-left font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entry.rows.map((row, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a row's place is its identity.
              <tr key={r}>
                {row.map((cell, c) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a cell's place is its identity.
                  <td key={c} className="border border-line px-2 py-0.5 align-top whitespace-pre-wrap">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {(entry.hiddenRows > 0 || entry.hiddenColumns > 0) && (
          <p className="mt-1 text-muted">
            {[
              entry.hiddenRows > 0 && ROWS_CUT(MAX_TABLE_ROWS),
              entry.hiddenColumns > 0 && COLUMNS_CUT(MAX_TABLE_COLUMNS),
            ]
              .filter(Boolean)
              .join(' ')}
          </p>
        )}
      </div>
    )
  const level = MARKED_LEVELS[entry.level]
  return (
    <div
      className={cn('flex gap-1.5 py-px whitespace-pre-wrap [overflow-wrap:anywhere]', level?.tone)}
      style={entry.indent ? { paddingLeft: `${entry.indent * 1.25}em` } : undefined}
      data-level={entry.level}
    >
      {level && <level.Icon className="mt-[3px] size-3.5 shrink-0" aria-hidden />}
      <span className="min-w-0">
        {level && <span className="sr-only">{level.label}</span>}
        {entry.text}
      </span>
    </div>
  )
}

function RunPanel({ target, edits }: { target: RunTarget; edits: RunEdits }) {
  const { lang, code: original, key } = target
  const [code, setCode] = useState(() => edits.get(key) ?? original)
  const runner = useRunner(lang)
  const editor = useRef<HTMLTextAreaElement>(null)
  const [mac, setMac] = useState(false)
  useEffect(() => setMac(isMac()), [])

  const change = (next: string) => {
    setCode(next)
    if (next === original) edits.delete(key)
    else edits.set(key, next)
  }
  const start = () => void runner.run(code)
  const { status, output, error, hint, ms, busy } = runner

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <label htmlFor="run-editor" className="text-[13px] font-semibold text-muted">
        Code
      </label>
      <textarea
        id="run-editor"
        ref={editor}
        data-autofocus
        data-testid="run-editor"
        value={code}
        maxLength={MAX_RUN_CODE}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        wrap="off"
        rows={8}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            if (!busy) start()
          }
        }}
        className="-mt-2 max-h-[45%] min-h-[calc(8lh+1.5rem)] w-full shrink-0 resize-y overflow-auto rounded-lg border border-line bg-inset p-3 font-mono text-[13.5px] leading-relaxed text-ink [tab-size:2] focus-visible:outline-2 focus-visible:outline-accent max-sm:min-h-[calc(6lh+1.5rem)]"
      />
      <div className="flex flex-wrap items-center gap-2">
        {busy ? (
          <button
            type="button"
            data-testid="run-stop"
            onClick={runner.stop}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[14.5px] font-semibold text-ink transition hover:border-accent-line hover:bg-panel"
          >
            <Square className="size-4" aria-hidden />
            Stop
          </button>
        ) : (
          <button
            type="button"
            data-testid="run-start"
            onClick={start}
            aria-keyshortcuts={mac ? 'Meta+Enter' : 'Control+Enter'}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent-fill px-4 text-[14.5px] font-semibold text-on-accent transition hover:brightness-105"
          >
            <Play className="size-4" aria-hidden />
            Run
            <kbd className="ml-1 rounded border border-current/25 px-1.5 font-sans text-[12px] font-medium opacity-80">
              {shortcutText(mac)}
            </kbd>
          </button>
        )}
        <button
          type="button"
          data-testid="run-reset"
          disabled={code === original}
          onClick={() => {
            change(original)
            editor.current?.focus()
          }}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[14.5px] font-semibold text-ink transition hover:border-accent-line hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="size-4" aria-hidden />
          Reset
        </button>
      </div>
      {lang === 'typescript' && (
        <p className="text-[13.5px] text-muted" data-testid="run-note">
          {TYPESCRIPT_NOTE}
        </p>
      )}
      <section
        aria-label="Output"
        data-testid="run-output"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a region that scrolls must be reachable by keyboard.
        tabIndex={0}
        className="min-h-[calc(6lh+1.5rem)] flex-1 overflow-auto rounded-lg border border-line bg-surface p-3 font-mono text-[13px] leading-snug text-ink"
      >
        {output.shown.length === 0 && status === 'idle' ? (
          <p className="font-sans text-muted">{OUTPUT_EMPTY}</p>
        ) : (
          output.shown.map((entry, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: output only grows during a run, and starts again with the next.
            <Entry key={i} entry={entry} />
          ))
        )}
      </section>
      <div className="space-y-1">
        <p role="status" data-testid="run-status" className="text-[14px] text-body">
          {statusText({ status, lang, mac, ms, empty: output.count === 0, line: error?.line })}
        </p>
        {hint && (
          <p data-testid="run-hint" className="text-[14px] text-muted">
            {hint}
          </p>
        )}
      </div>
    </div>
  )
}

export function RunDialog({
  target,
  access,
  edits,
  onClose,
}: {
  target: RunTarget | null
  access: RunAccess
  edits: RunEdits
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = dialog.current
    if (!el || !target) return
    if (!el.open) el.showModal()
    el.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    const opener = target.opener
    return () => {
      if (el.open) el.close()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [target])

  const here = typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}`

  return (
    <dialog
      ref={dialog}
      data-testid="run-dialog"
      aria-labelledby="run-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
      }}
      className="m-auto h-dvh max-h-none w-screen max-w-none overflow-hidden bg-surface p-0 font-sans text-ink shadow-2xl backdrop:bg-black/50 sm:h-auto sm:max-h-[90vh] sm:w-[min(56rem,calc(100vw-2rem))] sm:rounded-2xl sm:border sm:border-line"
    >
      {target && (
        <div className="flex h-full max-h-[inherit] flex-col p-4 sm:max-h-[90vh] sm:p-6">
          <header className="mb-3 flex items-center justify-between gap-3">
            <h2
              id="run-title"
              data-testid="run-title"
              className="font-display text-[20px] leading-tight font-bold tracking-[-0.01em]"
            >
              {titleText(target.lang)}
            </h2>
            <button
              type="button"
              data-testid="run-close"
              aria-label="Close"
              onClick={onClose}
              className="grid size-11 shrink-0 place-items-center rounded-full text-muted transition hover:bg-inset hover:text-ink"
            >
              <X className="size-5" aria-hidden />
            </button>
          </header>
          {access === 'signed_in' ? (
            <RunPanel key={target.key} target={target} edits={edits} />
          ) : (
            <div className="min-h-0 overflow-auto">
              <div className="rounded-xl border border-line bg-inset p-4 text-[14.5px] leading-relaxed">
                <p data-testid="run-signed-out">{SIGNED_OUT_TEXT}</p>
                <Link
                  to="/login"
                  search={{ next: here }}
                  data-testid="run-sign-in"
                  className="mt-3 inline-flex h-11 items-center rounded-xl bg-accent-fill px-5 font-semibold text-on-accent transition hover:brightness-105"
                >
                  Sign in
                </Link>
              </div>
              <ReadOnlyCode code={target.code} />
            </div>
          )}
        </div>
      )}
    </dialog>
  )
}
