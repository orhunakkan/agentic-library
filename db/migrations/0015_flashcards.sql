-- Flashcards: question-and-answer cards a reader saved from Ask's quiz or flashcards, reviewed on the Flashcards
-- page on a Leitner schedule (src/shared/flashcards/schedule.ts). A card belongs to a catalogue book (book_slug) or
-- one of the user's private books (user_book_id), never both, with the page it came from. Deleting the user or the
-- private book deletes its cards.
create table flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references users (id) on delete cascade,
  book_slug text check (char_length(book_slug) between 1 and 200),
  user_book_id uuid references user_books (id) on delete cascade,
  -- Chapter books: the chapter's slug and the screen page (1-based). Paged books: null and the printed page.
  chapter text check (char_length(chapter) between 1 and 200),
  page integer not null check (page between 1 and 100000),
  front text not null check (char_length(front) between 1 and 200),
  back text not null check (char_length(back) between 1 and 500),
  -- Where it was saved from: 'quiz' or 'flashcards', checked in code (the list may grow).
  origin text not null,
  -- The Leitner box, 0 (new or forgotten) to 5, and when the card is next due.
  box smallint not null default 0 check (box between 0 and 5),
  due_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((book_slug is null) <> (user_book_id is null))
);
-- One card per book with the same front, so saving one again finds the card it already is.
create unique index flashcards_user_slug_front_idx on flashcards (user_id, book_slug, front) where book_slug is not null;
create unique index flashcards_user_book_front_idx on flashcards (user_id, user_book_id, front) where user_book_id is not null;
-- For a book's due cards and the list of books.
create index flashcards_user_due_idx on flashcards (user_id, due_at);
-- For the cascade when a private book is deleted.
create index flashcards_user_book_idx on flashcards (user_book_id) where user_book_id is not null;
