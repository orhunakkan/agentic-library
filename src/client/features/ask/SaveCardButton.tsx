import { Check, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { saveProblemText } from '~/client/features/flashcards/flashcard-problems'
import { type FlashcardProblem, type NewCardRequest, saveCard } from '~/client/features/flashcards/flashcards-client'

export type SaveState =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'existed' }
  | { state: 'failed'; problem: FlashcardProblem }

export const isSaved = (s: SaveState) => s.state === 'saved' || s.state === 'existed'

export function useCardSaves(count: number) {
  const [states, setStates] = useState<SaveState[]>(() => Array.from({ length: count }, () => ({ state: 'idle' })))
  const live = useRef(states)
  const set = (i: number, next: SaveState) => {
    const copy = [...live.current]
    copy[i] = next
    live.current = copy
    setStates(copy)
  }
  const save = async (i: number, request: NewCardRequest) => {
    const now = live.current[i]
    if (!now || now.state === 'saving' || isSaved(now)) return
    set(i, { state: 'saving' })
    const result = await saveCard(request)
    set(
      i,
      result.ok ? { state: result.value.existed ? 'existed' : 'saved' } : { state: 'failed', problem: result.problem },
    )
  }
  return { states, save }
}

const LABEL: Record<Exclude<SaveState['state'], 'idle' | 'failed'>, string> = {
  saving: 'Saving…',
  saved: 'Saved',
  existed: 'Already saved',
}

export function SaveCardButton({ state, label, onSave }: { state: SaveState; label: string; onSave: () => void }) {
  const done = isSaved(state)
  const text = state.state === 'idle' || state.state === 'failed' ? label : LABEL[state.state]
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={onSave}
        disabled={state.state === 'saving' || done}
        data-testid="ask-save-card"
        className="-ml-2 inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-[12.5px] text-r-muted transition hover:bg-r-line/60 hover:text-r-ink disabled:hover:bg-transparent"
      >
        {done ? <Check className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
        {text}
      </button>
      {state.state === 'failed' && (
        <p role="alert" className="text-[12.5px] text-r-ink" data-testid="ask-save-card-error">
          {saveProblemText(state.problem)}
        </p>
      )}
    </div>
  )
}
