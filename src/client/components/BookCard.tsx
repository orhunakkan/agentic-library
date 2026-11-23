import { Headphones } from 'lucide-react'
import { cn } from '~/client/lib/cn'
import type { ShelfBook } from '~/shared/content/library'
import { AppLink } from './AppLink'
import { BookCover } from './BookCover'

export function BookCard({ book, large }: { book: ShelfBook; large?: boolean }) {
  return (
    <AppLink
      href={book.href}
      viewTransition
      className="group block outline-none"
      data-testid="book-card"
      data-key={book.slug}
    >
      <div className="transition duration-200 ease-out group-hover:-translate-y-1 group-focus-visible:-translate-y-1">
        <BookCover
          title={book.title}
          author={book.author}
          cover={book.cover}
          image={book.image}
          transitionName={`cover-${book.slug}`}
          className="shadow-[0_12px_28px_-14px_rgb(0_0_0/0.6)] ring-accent ring-offset-2 ring-offset-page group-focus-visible:ring-2"
        />
      </div>
      <p
        className={cn(
          'mt-3 line-clamp-2 leading-[1.3] font-semibold text-ink transition group-hover:text-accent',
          large ? 'text-[16px]' : 'text-[15px]',
        )}
      >
        {book.title}
      </p>
      <p className="mt-0.5 truncate text-[13px] text-subtle">{book.author}</p>
      {book.hasAudio && (
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-hue-cyan-ink">
          <Headphones className="size-[13px]" aria-hidden />
          Audiobook
        </p>
      )}
    </AppLink>
  )
}
