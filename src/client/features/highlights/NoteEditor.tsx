import { useEffect, useId, useRef, useState } from 'react'
import { MAX_NOTE, NOTE_COUNT_FROM } from '~/shared/highlights/limits'

export function NoteEditor({
  initial,
  autoFocus,
  onSave,
  onCancel,
}: {
  initial: string
  autoFocus: boolean
  onSave: (note: string) => Promise<boolean>
  onCancel: () => void
}) {
  const id = useId()
  const box = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState(initial)
  const [saving, setSaving] = useState(false)
  const count = [...text].length
  const over = count > MAX_NOTE

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once, when it opens
  useEffect(() => {
    if (!autoFocus) return
    const frame = requestAnimationFrame(() => {
      box.current?.focus()
      box.current?.setSelectionRange(text.length, text.length)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 22
    el.style.height = `${Math.min(el.scrollHeight, line * 8 + 18)}px`
  }, [text])

  const save = async () => {
    if (saving || over) return
    setSaving(true)
    const ok = await onSave(text)
    setSaving(false)
    if (!ok) box.current?.focus()
  }

  return (
    <div data-note-editor className="mt-2 space-y-2">
      <label htmlFor={id} className="sr-only">
        Note
      </label>
      <textarea
        ref={box}
        id={id}
        data-testid="note-input"
        value={text}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void save()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
        aria-describedby={count >= NOTE_COUNT_FROM ? `${id}-count` : undefined}
        className="block w-full resize-none rounded-lg border border-r-line bg-r-paper px-3 py-2 font-sans text-[14px] leading-[22px] text-r-ink outline-none focus:border-r-accent/70"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="note-save"
          onClick={() => void save()}
          disabled={saving || over}
          className="inline-flex h-9 items-center rounded-full bg-r-accent px-4 text-[13px] font-semibold text-r-paper transition hover:brightness-105 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          data-testid="note-cancel"
          onClick={onCancel}
          className="inline-flex h-9 items-center rounded-full px-3 text-[13px] text-r-muted transition hover:bg-r-line/60 hover:text-r-ink"
        >
          Cancel
        </button>
        {count >= NOTE_COUNT_FROM && (
          <p
            id={`${id}-count`}
            data-testid="note-count"
            className={over ? 'ml-auto text-[12px] text-r-emph' : 'ml-auto text-[12px] text-r-muted'}
          >
            {count.toLocaleString('en-US')} / {MAX_NOTE.toLocaleString('en-US')}
          </p>
        )}
      </div>
    </div>
  )
}
