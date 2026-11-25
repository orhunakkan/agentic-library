import { Link, useRouteContext } from '@tanstack/react-router'
import { Check, LibraryBig, ListPlus, X } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { SignInAgain } from '~/client/components/SignInAgain'
import { cleanShelfName, SHELF_NAME_MAX } from '~/shared/shelves/shelves'
import { findByName, problemText, shelfButton } from './shelf-list'
import type { ShelfProblem } from './shelves-client'
import { useShelves } from './use-shelves'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href]'

export function AddToShelf({ slug }: { slug: string }) {
  const { viewer } = useRouteContext({ from: '__root__' })
  return viewer ? <ShelfPicker slug={slug} /> : null
}

function ShelfPicker({ slug }: { slug: string }) {
  const id = useId()
  const api = useShelves()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<{ text: string; signIn: boolean } | null>(null)
  const [shift, setShift] = useState(0)
  const wrapper = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)

  const label = shelfButton(api.shelves, slug)
  const cleaned = cleanShelfName(name)
  const existing = cleaned ? findByName(api.shelves, cleaned) : undefined

  const close = () => {
    setOpen(false)
    button.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open) {
      setShift(0)
      return
    }
    const rect = popover.current?.getBoundingClientRect()
    if (rect) setShift(Math.min(0, document.documentElement.clientWidth - 16 - rect.right))
  }, [open])

  useEffect(() => {
    if (!open) return
    const first = popover.current?.querySelector<HTMLElement>('input[type="checkbox"]:not([disabled])')
    ;(first ?? nameInput.current)?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  const show = (found: ShelfProblem, context: { name?: string; book?: boolean } = {}) =>
    setProblem({ text: problemText(found, context), signIn: found === 'signed_out' })

  async function toggle(key: string, on: boolean) {
    setProblem(null)
    const found = await api.toggle(key, slug, on)
    if (found) show(found)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!cleaned) return
    setProblem(null)
    setName('')
    if (existing) {
      if (!existing.pending && !existing.books.includes(slug)) await toggle(existing.key, true)
      return
    }
    const found = await api.create(cleaned, slug)
    if (found) {
      setName(cleaned)
      show(found, { name: cleaned, book: true })
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(popover.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    if (focusable.length === 0) return
    event.preventDefault()
    const at = focusable.indexOf(document.activeElement as HTMLElement)
    const step = event.shiftKey ? -1 : 1
    const next = at === -1 ? 0 : (at + step + focusable.length) % focusable.length
    focusable[next]?.focus()
  }

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        data-testid="book-add-to-shelf"
        aria-expanded={open}
        title={label.kind === 'one' ? `On “${label.name}”` : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex h-12 items-center gap-2 rounded-xl border border-line bg-surface px-5 text-[15px] font-semibold text-ink transition hover:-translate-y-0.5 hover:bg-panel active:scale-[.98]"
      >
        {label.kind === 'none' ? (
          <ListPlus className="size-[18px]" aria-hidden />
        ) : (
          <LibraryBig className="size-[18px]" aria-hidden />
        )}
        {label.kind === 'none' && 'Add to shelf'}
        {label.kind === 'one' && (
          <span className="flex min-w-0 items-center">
            On “<span className="max-w-[180px] truncate">{label.name}</span>”
          </span>
        )}
        {label.kind === 'many' && `On ${label.count} shelves`}
      </button>
      {open && (
        <div
          ref={popover}
          role="dialog"
          data-testid="shelf-picker"
          aria-labelledby={`${id}-title`}
          onKeyDown={onKeyDown}
          style={{ transform: shift ? `translateX(${shift}px)` : undefined }}
          className="absolute top-full left-0 z-40 mt-2 w-[min(320px,calc(100vw-32px))] rounded-[18px] border border-line bg-surface p-4 text-ink shadow-[0_18px_40px_-18px_rgb(0_0_0/0.5)]"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 id={`${id}-title`} className="font-display text-[17px] font-bold">
              Add to shelf
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              data-testid="shelf-picker-close"
              className="inline-flex size-9 items-center justify-center rounded-lg text-subtle transition hover:bg-panel hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {api.status === 'loading' && (
            <p className="mt-2 text-[14px] text-muted" data-testid="shelf-picker-loading">
              Loading your shelves…
            </p>
          )}
          {api.status === 'unavailable' && api.shelves.length === 0 && (
            <p className="mt-2 text-[14px] text-muted" data-testid="shelf-picker-unavailable">
              Your shelves couldn’t be loaded.
            </p>
          )}
          {api.status === 'ready' && api.shelves.length === 0 && (
            <p className="mt-2 text-[14px] text-muted" data-testid="shelf-picker-empty">
              You have no shelves yet. Name one below.
            </p>
          )}
          {api.shelves.length > 0 && (
            <ul className="mt-2 max-h-[min(280px,40vh)] space-y-0.5 overflow-y-auto">
              {api.shelves.map((shelf) => {
                const on = shelf.books.includes(slug)
                return (
                  <li key={shelf.key}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-[15px] hover:bg-panel has-[:disabled]:cursor-default has-[:disabled]:opacity-60">
                      <span className="relative inline-flex size-5 shrink-0">
                        <input
                          type="checkbox"
                          data-testid="shelf-picker-shelf"
                          data-key={shelf.key}
                          checked={on}
                          disabled={shelf.pending}
                          onChange={(e) => void toggle(shelf.key, e.target.checked)}
                          className="peer size-5 cursor-pointer appearance-none rounded-md border border-line bg-surface checked:border-accent-fill checked:bg-accent-fill focus-visible:ring-4 focus-visible:ring-accent/25 focus-visible:outline-none disabled:cursor-default"
                        />
                        <Check
                          className="pointer-events-none absolute inset-0 m-auto hidden size-3.5 text-on-accent peer-checked:block"
                          aria-hidden
                        />
                      </span>
                      <span className="min-w-0 break-words">{shelf.name}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}

          {problem && (
            <p
              role="alert"
              data-testid="shelf-picker-error"
              className="mt-3 text-[14px] text-red-700 dark:text-red-300"
            >
              {problem.text}
              {problem.signIn && <SignInAgain testId="shelf-picker-sign-in" />}
            </p>
          )}

          <form onSubmit={submit} className="mt-3 border-t border-line pt-3">
            <label htmlFor={`${id}-name`} className="text-[13.5px] font-semibold text-body">
              New shelf
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                ref={nameInput}
                id={`${id}-name`}
                data-testid="shelf-picker-name"
                value={name}
                maxLength={SHELF_NAME_MAX}
                placeholder="e.g. To read"
                autoComplete="off"
                onChange={(e) => setName(e.target.value)}
                className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-[15px] text-ink outline-none placeholder:text-subtle focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
              <button
                type="submit"
                disabled={!cleaned}
                data-testid="shelf-picker-add"
                className="inline-flex h-11 max-w-[55%] shrink-0 items-center rounded-xl bg-accent-fill px-4 text-[14.5px] font-semibold text-on-accent transition hover:brightness-105 disabled:opacity-50"
              >
                <span className="truncate">{existing ? `Add to “${existing.name}”` : 'Add'}</span>
              </button>
            </div>
          </form>

          <p className="mt-3 text-[13px] text-muted">
            Rename or delete shelves in the{' '}
            <Link
              to="/library"
              className="font-semibold text-ink underline underline-offset-4"
              data-testid="shelf-picker-library"
            >
              Library
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}
