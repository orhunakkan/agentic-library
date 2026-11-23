import { useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import type { FlashcardView } from '~/shared/flashcards/contract'
import { dueLabel } from './dates'
import { DELETE_PROBLEM } from './flashcard-problems'
import { deleteCard } from './flashcards-client'

export function CardList({ cards, onDeleted }: { cards: FlashcardView[]; onDeleted: (id: string) => void }) {
  if (!cards.length)
    return (
      <p className="text-[14.5px] text-muted" data-testid="flashcards-cards-empty">
        No cards left in this book.
      </p>
    )
  return (
    <ul className="divide-y divide-line">
      {cards.map((card) => (
        <CardItem key={card.id} card={card} onDeleted={() => onDeleted(card.id)} />
      ))}
    </ul>
  )
}

const small =
  'inline-flex min-h-9 items-center rounded-full px-3 text-[13px] font-medium transition disabled:opacity-50'
const danger = `${small} text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40`

function CardItem({ card, onDeleted }: { card: FlashcardView; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [state, setState] = useState<'idle' | 'deleting' | 'failed'>('idle')
  const remove = async () => {
    setState('deleting')
    const result = await deleteCard(card.id)
    if (result.ok || result.problem === 'not_found') onDeleted()
    else setState('failed')
  }
  return (
    <li className="py-4 text-[14.5px] first:pt-0 last:pb-0" data-testid="flashcards-card" data-key={card.id}>
      <p className="font-semibold text-ink [overflow-wrap:anywhere]">{card.front}</p>
      <p className="mt-1 leading-relaxed whitespace-pre-line text-muted [overflow-wrap:anywhere]">{card.back}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
        {card.source && (
          <AppLink
            href={card.source.pageHref}
            preload={false}
            data-testid="flashcards-card-source"
            data-key={card.id}
            className="text-accent underline-offset-2 hover:underline"
          >
            From {card.source.label}
          </AppLink>
        )}
        <span suppressHydrationWarning data-testid="flashcards-card-due" data-key={card.id}>
          {dueLabel(card.dueAt, new Date())}
        </span>
        {confirming ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="text-ink">Delete this card?</span>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={state === 'deleting'}
              className={danger}
              data-testid="flashcards-card-delete-confirm"
              data-key={card.id}
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false)
                setState('idle')
              }}
              className={`${small} text-ink hover:bg-panel/60`}
              data-testid="flashcards-card-delete-cancel"
              data-key={card.id}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={danger}
            data-testid="flashcards-card-delete"
            data-key={card.id}
          >
            Delete<span className="sr-only"> this card</span>
          </button>
        )}
      </div>
      {state === 'failed' && (
        <p
          role="alert"
          className="mt-1 text-[13px] text-ink"
          data-testid="flashcards-card-delete-error"
          data-key={card.id}
        >
          {DELETE_PROBLEM}
        </p>
      )}
    </li>
  )
}
