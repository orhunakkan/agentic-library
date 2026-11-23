import { Pencil, Trash2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { Button } from '~/client/features/account/ui'
import type { ShelfView } from '~/shared/shelves/contract'
import { cleanShelfName, SHELF_NAME_MAX } from '~/shared/shelves/shelves'
import { findByName, problemText } from './shelf-list'
import type { ShelvesApi } from './use-shelves'

const textButton =
  'inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13.5px] font-semibold text-subtle transition hover:bg-panel hover:text-ink'

export interface ShelfActionsParts {
  heading: ReactNode
  actions: ReactNode
  notice: ReactNode
}

export function ShelfActions({
  shelf,
  titleId,
  api,
  onDeleted,
  children,
}: {
  shelf: ShelfView
  titleId: string
  api: Pick<ShelvesApi, 'shelves' | 'rename' | 'remove'>
  onDeleted: () => void
  children: (parts: ShelfActionsParts) => ReactNode
}) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const renameButton = useRef<HTMLButtonElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const renaming = draft !== null

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the row shows another shelf
  useEffect(() => {
    setDraft(null)
    setRenameError(null)
    setDeleteError(null)
    setConfirming(false)
  }, [shelf.id])

  useEffect(() => {
    if (!renaming) return
    input.current?.focus()
    input.current?.select()
  }, [renaming])

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (confirming && !el.open) {
      el.showModal()
      el.querySelector<HTMLButtonElement>('[data-cancel]')?.focus()
    }
    if (!confirming && el.open) el.close()
  }, [confirming])

  const closeRename = () => {
    setDraft(null)
    setRenameError(null)
    requestAnimationFrame(() => renameButton.current?.focus())
  }

  const cleaned = draft === null ? null : cleanShelfName(draft)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!cleaned) return
    if (cleaned === shelf.name) return closeRename()
    const clash = findByName(api.shelves, cleaned)
    if (clash && clash.id !== shelf.id) {
      setRenameError(problemText('duplicate', { name: clash.name }))
      return
    }
    const attempted = draft ?? cleaned
    closeRename()
    const problem = await api.rename(shelf.id, cleaned)
    if (problem && problem !== 'not_found') {
      setDraft(attempted)
      setRenameError(problemText(problem, { name: cleaned }))
    }
  }

  const cancelDelete = () => {
    setConfirming(false)
    deleteButton.current?.focus()
  }

  async function confirmDelete() {
    setDeleting(true)
    const problem = await api.remove(shelf.id)
    setDeleting(false)
    setConfirming(false)
    if (problem) {
      setDeleteError('Couldn’t delete the shelf. Try again.')
      deleteButton.current?.focus()
      return
    }
    onDeleted()
  }

  const heading = renaming ? (
    <form onSubmit={save} className="flex min-w-0 flex-wrap items-center gap-2">
      <label htmlFor={titleId} className="sr-only">
        Shelf name
      </label>
      <input
        ref={input}
        id={titleId}
        data-testid="shelf-rename-input"
        value={draft}
        maxLength={SHELF_NAME_MAX}
        onChange={(e) => {
          setDraft(e.target.value)
          setRenameError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            closeRename()
          }
        }}
        aria-invalid={renameError ? true : undefined}
        aria-describedby={renameError ? `${id}-rename-error` : undefined}
        className="h-11 w-[min(320px,100%)] rounded-xl border border-line bg-surface px-3 font-display text-[20px] font-bold text-ink outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
      />
      <Button
        type="submit"
        disabled={!cleaned}
        data-testid="shelf-rename-save"
        className="h-11 px-4 text-[14px] disabled:opacity-50"
      >
        Save
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={closeRename}
        data-testid="shelf-rename-cancel"
        className="h-11 px-4 text-[14px]"
      >
        Cancel
      </Button>
      {renameError && (
        <p
          id={`${id}-rename-error`}
          role="alert"
          data-testid="shelf-rename-error"
          className="basis-full text-[14px] text-red-700 dark:text-red-300"
        >
          {renameError}
        </p>
      )}
    </form>
  ) : (
    <h2
      id={titleId}
      data-testid="shelf-name"
      className="font-display text-[26px] leading-tight font-bold tracking-[-0.02em] text-ink"
    >
      {shelf.name}
    </h2>
  )

  const actions = (
    <span className="flex items-center gap-1 sm:ml-auto">
      {!renaming && (
        <button
          ref={renameButton}
          type="button"
          data-testid="shelf-rename"
          onClick={() => {
            setDeleteError(null)
            setDraft(shelf.name)
          }}
          className={textButton}
        >
          <Pencil className="size-3.5" aria-hidden />
          Rename
        </button>
      )}
      <button
        ref={deleteButton}
        type="button"
        data-testid="shelf-delete"
        onClick={() => {
          setDeleteError(null)
          setConfirming(true)
        }}
        className={textButton}
      >
        <Trash2 className="size-3.5" aria-hidden />
        Delete
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-delete-title`}
        aria-describedby={`${id}-delete-text`}
        onCancel={(e) => {
          e.preventDefault()
          cancelDelete()
        }}
        className="m-auto max-w-[min(420px,calc(100vw-32px))] rounded-[22px] border border-line bg-surface p-6 text-ink backdrop:bg-black/40"
      >
        <h2 id={`${id}-delete-title`} className="font-display text-[20px] font-bold">
          Delete “{shelf.name}”?
        </h2>
        <p id={`${id}-delete-text`} className="mt-2 text-[15px] leading-relaxed text-body">
          The books stay in your library.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            type="button"
            variant="danger"
            disabled={deleting}
            onClick={confirmDelete}
            data-testid="shelf-delete-confirm"
          >
            Delete shelf
          </Button>
          <Button
            data-cancel
            type="button"
            variant="secondary"
            onClick={cancelDelete}
            data-testid="shelf-delete-cancel"
          >
            Cancel
          </Button>
        </div>
      </dialog>
    </span>
  )

  const notice = deleteError && (
    <p role="alert" data-testid="shelf-delete-error" className="mt-2 text-[14px] text-red-700 dark:text-red-300">
      {deleteError}
    </p>
  )

  return children({ heading, actions, notice })
}
