import { Link } from '@tanstack/react-router'
import { Layers } from 'lucide-react'
import { useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { AccountPage, Button, Notice, Section } from '~/client/features/account/ui'
import type {
  BookFlashcards,
  FlashcardBookCount,
  FlashcardBookSummary,
  FlashcardView,
} from '~/shared/flashcards/contract'
import { ProNotice } from '../plans/ProNotice'
import { CardList } from './CardList'
import { bookLine } from './dates'
import { cardCountLine } from './flashcard-problems'
import { ReviewSession } from './ReviewSession'

export type FlashcardsNotice = 'deleted-book' | 'missing' | 'invalid' | 'unavailable'

const NOTICE_TEXT: Record<FlashcardsNotice, string> = {
  'deleted-book': 'Deleted every card in that book.',
  missing: 'Those cards weren’t found. They may have been deleted already.',
  invalid: 'That request wasn’t understood. Try again.',
  unavailable: 'Something went wrong. Try again in a few minutes.',
}

export function FlashcardsProPage({ books, notice }: { books: FlashcardBookCount[]; notice?: FlashcardsNotice }) {
  return (
    <AccountPage eyebrow="Account" title="Flashcards" titleTestId="flashcards-title" nav>
      {notice && (
        <Notice
          kind={notice === 'deleted-book' ? 'success' : 'error'}
          data-testid={notice === 'deleted-book' ? 'flashcards-deleted' : 'flashcards-error'}
        >
          {NOTICE_TEXT[notice]}
        </Notice>
      )}
      <ProNotice feature="flashcards" className="mt-6 space-y-2 text-[14.5px] leading-relaxed text-body" />
      {books.length > 0 && (
        <Section id="books" title="Your saved cards">
          <ul className="divide-y divide-line">
            {books.map((book) => (
              <li
                key={book.slug}
                className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                data-testid="flashcards-book"
                data-key={book.slug}
              >
                <Layers className="size-5 shrink-0 text-subtle" aria-hidden />
                <p
                  className="min-w-0 flex-1 text-[14.5px] text-ink"
                  data-testid="flashcards-book-count"
                  data-key={book.slug}
                >
                  {cardCountLine(book.title, book.cards)}
                </p>
                <form method="post" action="/account/flashcards">
                  <input type="hidden" name="intent" value="delete-book" />
                  <input type="hidden" name="book" value={book.slug} />
                  <Button
                    variant="danger"
                    aria-label={`Delete all cards for ${book.title}`}
                    data-testid="flashcards-delete-book"
                    data-key={book.slug}
                  >
                    Delete all for this book
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </AccountPage>
  )
}

export function FlashcardBooksPage({ books }: { books: FlashcardBookSummary[] }) {
  const now = new Date()
  return (
    <AccountPage
      eyebrow="Account"
      title="Flashcards"
      titleTestId="flashcards-title"
      lead="Cards you saved from Ask’s quizzes and flashcards, by book. Review the ones that are due."
      nav
    >
      <Section id="books" title="Your books">
        {books.length === 0 ? (
          <p className="text-[14.5px] text-muted" data-testid="flashcards-empty">
            No flashcards yet. In a book, open Ask and press Make flashcards, or save a quiz question as a card.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {books.map((book) => (
              <li
                key={book.slug}
                className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                data-testid="flashcards-book"
                data-key={book.slug}
              >
                <Layers className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden />
                <div className="min-w-0 flex-1 text-[14.5px]">
                  {book.removed ? (
                    <p className="font-medium text-ink">{book.title}</p>
                  ) : (
                    <Link
                      to="/account/flashcards"
                      search={{ book: book.slug }}
                      className="font-medium text-ink transition hover:text-accent"
                      data-testid="flashcards-book-link"
                      data-key={book.slug}
                    >
                      {book.title}
                    </Link>
                  )}
                  <p
                    className="text-muted"
                    suppressHydrationWarning
                    data-testid="flashcards-book-count"
                    data-key={book.slug}
                  >
                    {bookLine(book, now)}
                  </p>
                </div>
                {book.due > 0 && !book.removed && (
                  <Link
                    to="/account/flashcards"
                    search={{ book: book.slug }}
                    data-testid="flashcards-book-review"
                    data-key={book.slug}
                    className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-accent/12 px-3 text-[13px] font-medium text-accent transition hover:bg-accent/20"
                  >
                    Review {book.due.toLocaleString('en-GB')}
                    <span className="sr-only"> cards in {book.title}</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </AccountPage>
  )
}

export function BookFlashcardsPage({ data }: { data: BookFlashcards }) {
  const [cards, setCards] = useState<FlashcardView[]>(data.cards)
  const [deleted, setDeleted] = useState<string[]>([])
  const replace = (card: FlashcardView) => setCards((all) => all.map((c) => (c.id === card.id ? card : c)))
  const remove = (id: string) => {
    setCards((all) => all.filter((c) => c.id !== id))
    setDeleted((ids) => [...ids, id])
  }
  return (
    <AccountPage
      eyebrow="Account"
      title="Flashcards"
      titleTestId="flashcards-title"
      lead={
        <AppLink
          href={data.book.href}
          data-testid="flashcards-open-book"
          className="font-medium text-accent underline-offset-2 hover:underline"
        >
          {data.book.title}
        </AppLink>
      }
    >
      <div className="mt-5 text-[14.5px]">
        <Link
          to="/account/flashcards"
          data-testid="flashcards-all-books"
          className="font-medium text-accent underline-offset-2 hover:underline"
        >
          ← All books
        </Link>
      </div>
      <ReviewSession due={data.due} cards={cards} deleted={deleted} onGraded={replace} />
      <Section
        id="cards"
        title={`All cards (${cards.length.toLocaleString('en-GB')})`}
        titleTestId="flashcards-card-count"
      >
        <CardList cards={cards} onDeleted={remove} />
      </Section>
    </AccountPage>
  )
}
