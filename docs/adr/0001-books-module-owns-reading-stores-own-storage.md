# The books module owns reading a book; stores own storing one

Every read of a book (opening it by its book slug, the reader page, in-book search, read aloud, audio, the offline copy) goes through one books module, for catalogue and private books alike and for signed-out people too. The stores that write private books (`user-books`, `audiobooks`, `book-details`, `book-images`) keep their own `status = 'ready'` SQL instead of borrowing the books module's: they own the rows and the import lifecycle, and routing their storage queries through a reading module would make it shallow and invert the dependency. This was first decided in issue #70, which no longer exists; `tests/seams.test.ts` enforces it.

## Consequences

- A future review counting `status = 'ready'` copies will find several in the stores. That is deliberate, not drift.
- A book slug is parsed only by the shared book slug codec; the `u-` prefix appears nowhere else (also a seams rule).
