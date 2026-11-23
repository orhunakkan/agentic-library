import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import type { CardDraft } from '~/shared/ask/events'
import { AnswerText } from './AnswerText'
import { isSaved, SaveCardButton, useCardSaves } from './SaveCardButton'
import { studyHeading } from './study'
import type { ThreadStudy } from './thread-store'

export function CardsTurn({
  study,
  bookSlug,
  onNavigate,
}: {
  study: Extract<ThreadStudy, { kind: 'cards' }>
  bookSlug: string
  onNavigate?: () => void
}) {
  const saves = useCardSaves(study.cards.length)
  const [savingAll, setSavingAll] = useState(false)
  const request = (card: CardDraft) => ({
    book: bookSlug,
    front: card.front,
    back: card.back,
    position: card.source.position,
    origin: 'flashcards' as const,
  })
  const saveAll = async () => {
    setSavingAll(true)
    for (const [i, card] of study.cards.entries()) await saves.save(i, request(card))
    setSavingAll(false)
  }
  const saved = saves.states.filter(isSaved).length
  const allSaved = saved === study.cards.length
  return (
    <li className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13.5px] font-medium text-r-muted" data-testid="cards-heading">
          {studyHeading(study)}
        </p>
        {allSaved ? (
          <p className="text-[13.5px]" role="status" data-testid="cards-saved">
            Saved {saved}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => void saveAll()}
            disabled={savingAll}
            data-testid="cards-save-all"
            className="inline-flex h-9 items-center rounded-full border border-r-line px-3.5 text-[13px] font-medium transition hover:border-r-accent/60 disabled:opacity-50"
          >
            {savingAll ? 'Saving…' : 'Save all'}
          </button>
        )}
      </div>
      {saved > 0 && (
        <Link
          to="/account/flashcards"
          search={{ book: bookSlug }}
          onClick={onNavigate}
          data-testid="cards-review-link"
          className="inline-block text-[13.5px] text-r-accent underline underline-offset-2"
        >
          Review them on the Flashcards page
        </Link>
      )}
      <ul className="space-y-2.5">
        {study.cards.map((card, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the cards never move; the index is the card's place
          <li key={i} className="rounded-xl border border-r-line px-3.5 py-2.5" data-testid="cards-card" data-key={i}>
            <p className="text-[14.5px] leading-snug font-semibold [overflow-wrap:anywhere]">{card.front}</p>
            <div className="mt-1">
              <AnswerText text={card.back} citations={card.citations} onNavigate={onNavigate} />
            </div>
            <SaveCardButton
              state={saves.states[i] ?? { state: 'idle' }}
              label="Save"
              onSave={() => void saves.save(i, request(card))}
            />
          </li>
        ))}
      </ul>
    </li>
  )
}
