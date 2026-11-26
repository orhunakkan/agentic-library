# Implementation Plan: instance-limits

Source spec: [spec/SPEC-instance-limits.md](../spec/SPEC-instance-limits.md) (approved 2026-11-25)

Status: approved by the owner (2026-11-26)

Tasks: [tasks/instance-limits-todo.md](instance-limits-todo.md)

## Overview

Turn the five storage caps that are constants today (audio per user, one audiobook, pictures per user, books, saved
articles) into `LIMIT_*` settings, with today's values as defaults, and add a sixth, new cap: 1 MB of stored text for
one article. The server reads them from `getConfig().limits`. Store functions get them as a parameter, and the browser
gets them in the loader data it already loads. Every message names the configured value. The account page gains a
Storage section showing usage against the limits. There is no schema change. It's built in one go and ends in one
local commit on `main`, which isn't pushed. The owner then sets the hosted values on the server.

## Facts checked while planning (2026-11-26)

### The six caps

| Cap | Defined today | Read on the server | Read in the browser | Tests that pin it today |
|---|---|---|---|---|
| Audio per user, 8 GB | `MAX_USER_AUDIO_BYTES`, [audiobooks/limits.ts:8](../src/shared/audiobooks/limits.ts#L8) | `startAudiobook`, [audiobooks/store.ts:42-43](../src/server/audiobooks/store.ts#L42-L43) | `readAudiobook`, [read-audiobook.ts:161](../src/client/features/audiobook-import/read-audiobook.ts#L161). "8 GB" is hard-coded in [audiobook-problems.ts:52](../src/client/features/audiobook-import/audiobook-problems.ts#L52) | `audiobooks.db.test.ts` "says quota for the 25 books, the 8 GB of audio…" (line 253), `read-audiobook.test.ts:110`, `audiobook-problems.test.ts:20` |
| One audiobook, 2 GB | `MAX_AUDIOBOOK_BYTES`, [audiobooks/limits.ts:5](../src/shared/audiobooks/limits.ts#L5) | `parseAudiobookStart`, [input.ts:78](../src/shared/audiobooks/input.ts#L78) (each file) and [input.ts:83](../src/shared/audiobooks/input.ts#L83) (the total) | `readAudiobook`, [read-audiobook.ts:160](../src/client/features/audiobook-import/read-audiobook.ts#L160). "2 GB" is hard-coded in [audiobook-problems.ts:44](../src/client/features/audiobook-import/audiobook-problems.ts#L44) | `input.test.ts` "wants one M4B or MP3s of one kind, within the sizes" (lines 106-107), `read-audiobook.test.ts:109`, `audiobook-problems.test.ts:16` |
| Pictures per user, 250 MB | `MAX_USER_IMAGE_BYTES`, [import/limits.ts:26](../src/shared/import/limits.ts#L26) | `startImport`, [user-books.ts:120-121](../src/server/user-books.ts#L120-L121); `storeImage`, [book-images/store.ts:51](../src/server/book-images/store.ts#L51) | `BookImporter.tsx:273` and `:701`, [article-save.ts:78](../src/client/features/articles/article-save.ts#L78), the `BOOK_ROOM` default in [draft.ts:146](../src/shared/import/draft.ts#L146) | `book-images.db.test.ts` "keeps the account within 250 MB across its books" (117), lines 230-258; `article-save.test.ts` "leaves out the pictures past the account's room" (118); `draft.test.ts` calls `BOOK_ROOM()` 3 times |
| Books per user, 25 | `MAX_BOOKS`, [import/limits.ts:4](../src/shared/import/limits.ts#L4) | `startImport` (default `maxBooks`), `startAudiobook` (default `maxBooks`); handlers pass `MAX_BOOKS` in [book-actions.ts:71](../src/server/book-actions.ts#L71) and [audiobooks/actions.ts:78](../src/server/audiobooks/actions.ts#L78) | `BOOK_QUOTA_TEXT` in [import-problems.ts:7](../src/client/features/import/import-problems.ts#L7), reused by `audiobook-problems.ts:60`; **`pickRefusal` in [pick.ts:24](../src/client/features/import/pick.ts#L24)** | `user-books.db.test.ts` lines 126, 134, 319, 326, 345, 359; `audiobooks.db.test.ts:253`; `pick.test.ts` "refuses a book or an audiobook at the book limit" |
| Saved articles, 500 | `MAX_ARTICLES`, [articles/contract.ts:1](../src/shared/articles/contract.ts#L1) | `startImport`'s article branch, through `ArticleStart.max`, which [book-actions.ts:70](../src/server/book-actions.ts#L70) sets; `articlesState` sends it as `max` ([articles/actions.ts:142](../src/server/articles/actions.ts#L142)) | **`articleProblemText`'s fallback in [article-messages.ts:55](../src/client/features/articles/article-messages.ts#L55)**; `countText` already takes `max` | `articles.db.test.ts` "lets a plain member save 500 articles…" (381), lines 431 and 449; `article-messages.test.ts:41`; `articles.spec.ts` "0 of 500 articles" (27, 36) |
| Text of one article (new), 1 MB | none. Articles get the 8 MB book cap, `MAX_BOOK_HTML_BYTES` | `storeChapter`, [user-books.ts:157](../src/server/user-books.ts#L157), for every book | no check. An over-size article's chapter refusal shows the generic "Something went wrong" ([article-save.ts:97](../src/client/features/articles/article-save.ts#L97)) | `user-books.db.test.ts` "counts rendered HTML against the 8 MB book limit" (114), for books only |

### Where this differs from the spec, or what the spec doesn't say

- **Two readers aren't in the spec's table.** `pickRefusal` in `pick.ts` reads `MAX_BOOKS`, and `articleProblemText`
  falls back to `MAX_ARTICLES`. Both are in the deleted constants' path, so the compiler would find them anyway.
  Tasks 4 and 5 list them.
- **A `formatBytes` already exists**, in [src/client/lib/format.ts:50](../src/client/lib/format.ts#L50). It prints
  `1.0 MB` and `2.4 MB`, has no GB, and `DownloadButton.tsx` uses it for "Downloaded · 2.4 MB". A second
  `formatBytes` in `src/shared/lib/` with different output would be two functions with one name. There's also a third
  formatter, `megabytes` in `shared/read-aloud/folio-voices.ts`, for voice sizes, which this module doesn't touch.
  See Decision 1.
- **`pnpm dev` doesn't refuse to start on a bad value.** Under `vite dev`, config is parsed on the first
  `getConfig()` call, so `LIMIT_USER_AUDIO=1 pnpm dev` starts and fails on the first request. The production entry,
  `startServer` in [scripts/serve.ts:38-45](../scripts/serve.ts#L38-L45), runs `parseConfig` before listening, prints
  `agentic-library: <message>` and exits 1. The spec's startup check is run as
  `pnpm build && LIMIT_USER_AUDIO=1 pnpm start` (see Decision 4). The e2e test server goes through `startServer`
  too.
- **A reader over a lowered picture limit couldn't import a book with no pictures.** `startImport` refuses when
  `images.bytes > left`, and `left` goes negative once usage is past the limit, so `0 > -5` refuses a text-only book
  or an article whose pictures were all left out. That breaks the spec's rule that only an upload adding to a full cap
  is refused. It can't happen today, because no limit has ever been lowered. Task 6 refuses only when the upload
  has pictures (Decision 3). The other caps are already right: books use `>=`, and audio and `storeImage` always add
  at least one byte.
- **The account page's Storage section needs the audiobooks flag.** The spec's `storage` shape is
  `{ bookCount, articleCount, audioBytes, pictureBytes, limits }`, but the audio line is hidden when audiobooks are
  off, and only `getMyBooksPage` sends `audiobooks` today. `storage` gains `audiobooks: boolean` (Decision 2).
- **Refusals lose `max` on the way to the message.** `ChangeResult` in [post.ts:2](../src/client/lib/post.ts#L2)
  carries only a problem code, and `importProblem` in `import-client.ts` drops the rest of the answer. For a message
  to use the `max` from the response, as the spec asks, book, picture, article and audio refusals must carry `max`
  to the copy. Tasks 3–8 each do this for their own refusal.
- **Store functions have about 105 call sites**, almost all in db tests that seed books: `startImport` 47,
  `storeChapter` 39, `storeImage` 22, `startAudiobook` 8. There's no shared seeding helper, so each call gains a
  `limits` argument. The compiler finds every one. Tests that only seed a book pass `DEFAULT_LIMITS`.
- **The server's refusal of an over-size audiobook is `400 invalid`, with no `max`.** `parseAudiobookStart` returns
  `null`, as it does for any malformed start. With the browser bypassed, that's still a refusal, which is what the
  spec's success criterion needs. The browser checks before uploading and names the value. This isn't changed.
- **The audiobook parser is passed by reference** (`parse: parseAudiobookStart` in `audiobooks/actions.ts:70`), and
  its second parameter is `now`. Taking the cap makes it `parseAudiobookStart(value, maxBytes, now = new Date())`,
  and the handler wraps it: `parse: (value) => parseAudiobookStart(value, getConfig().limits.audiobookBytes)`.
- **An over-size article reaches the text cap one chapter at a time.** An article is one draft chapter, but
  `splitOversized` in `shared/import/draft.ts` splits anything over the 900 KB request cap into parts. So an article
  over 1 MB arrives as two or more chapter uploads, and the refusal comes on the chapter that crosses the cap.
  Pictures are all uploaded before the first chapter (`private-book-save.ts:99-132`), so by then they exist and must
  be deleted with the row. Pictures are `bytea` rows in `user_book_images`, `on delete cascade` from `user_books`
  (`0009_book_images.sql`), and so are chapters (`0002_user_books.sql`). Deleting the `user_books` row in the same
  transaction removes all of it. The client already calls `steps.discard(id)` after any failed upload. That call is
  best effort, and after the server-side delete it finds nothing.
- **`storeChapter` doesn't read `article_url` today.** It selects `chapter_count, html_bytes … for update`. The column
  is added to that select, and the row stays the one that's locked.
- **The e2e article host serves fixed files.** `articles-stub.ts` maps `news` and `blog` to HTML files. An over-1 MB
  article needs a third page, built in code instead of committed as a 1 MB fixture. The article fetcher caps a page at
  5 MB (`MAX_PAGE_BYTES`), so the page has to land between 1 MB of rendered text and 5 MB of source.
- **Handler tests can't set env per test.** `getConfig()` caches its first parse, and nothing resets it. The precedent
  for other values is a partial `vi.mock('../config.ts', importOriginal)`, as in `github-repos/github.test.ts`. A new
  `src/server/instance-limits.db.test.ts` does that with a mutable `limits` object (through `vi.hoisted`), so each
  of the six caps is shown going from config to the handler's refusal. Store tests keep passing limits directly, as
  the spec says.
- **Every new `.ts` module needs a test that imports it** ([tests/tested-modules.test.ts](../tests/tested-modules.test.ts)).
  `limits.ts` is imported by `config.test.ts` and gets its own `limits.test.ts`, which pins the defaults. The Storage
  section's wording goes in `src/client/features/account/storage-text.ts`, with a test, following
  `access-token-text.ts`. `StorageSection.tsx` is `.tsx`, which the rule doesn't scan.
- **The spec's leftover `git grep` can print nothing.** Today it matches 23 files. Besides the constants, the literal
  hits are the two "2 GB"/"8 GB" strings in `audiobook-problems.ts` and their test, and two db test titles,
  `audiobooks.db.test.ts:253` ("the 8 GB of audio") and `book-images.db.test.ts:117` ("within 250 MB"). Those titles
  are renamed when their tests move to small limits. `GB`, `MB`, `KB`, `MAX_BOOK_HTML_BYTES` and the "8 MB" book copy
  stay, and the pattern doesn't match them. `\b` works in this machine's `git grep -E` (checked while planning).
- **No e2e spec asserts the cap copy.** The only cap-related e2e strings are "0 of 500 articles" and "1 of 500
  articles" in `articles.spec.ts`, which still hold with the hosted value of 500. The offline download control matches
  `/^Downloaded · \d+(\.\d)? (KB|MB)$/` (`tests/e2e/pages/components/download-control.ts:14`), which still matches
  if `1.0 MB` becomes `1 MB`.
- **The test server sets env in code.** `tests/e2e/support/test-server.ts:102-122` sets `MAIL_*`, `SIGNUP`,
  `AUDIOBOOKS_DIR` and others on `process.env` before `startServer`. The three hosted `LIMIT_*` values go there.
  `AUDIOBOOKS_DIR` is set, so the audio line shows in e2e.
- **Where the Storage section goes.** `PlanSection` sat between Profile and Email in
  `src/routes/account/index.tsx` until `5fd5ead1`. `getAccountPage` sends no counts today. It gains `countedBooks`,
  `countedArticles`, `audioBytesUsed`, `imageBytesUsed` and `audiobooksOn()`, which all exist already.
- **Counts include unfinished uploads.** `countedBooks` and `countedArticles` count `uploading` rows until
  `sweepStaleUploads` removes them after 24 hours. The Storage section shows the same numbers the quota checks use,
  so the two can't disagree.

### Coverage floors that apply

- **Unit** (`pnpm check`, `src/shared` and `src/client`), [vitest.config.ts:23](../vitest.config.ts#L23): statements
  92, branches 89, functions 91, lines 93. No per-file floors.
- **Server** (`pnpm test:db`, `src/server`), [vitest.db.config.ts:27-31](../vitest.db.config.ts#L27-L31): statements
  96, branches 93, functions 94, lines 96. `config.test.ts` runs in both commands, but `config.ts`'s coverage counts
  only here.
- **Per-file floors on files this module touches:** `src/server/articles/actions.ts` is at 100% on all four
  (`articlesState` gains `limits`). No other touched server file has a per-file floor. `user-books.ts`,
  `book-actions.ts`, `book-images/store.ts`, `audiobooks/store.ts`, `audiobooks/actions.ts`, `account-functions.ts`
  and `config.ts` count toward the totals only.
- `scripts/coverage/changed-lines.ts` reports changed-line coverage in CI but always exits 0. It isn't a floor.
- No floor is lowered. A new branch gets a test.

### Environment

- The newest migration is `0029_drop_billing.sql`. This module adds none.
- Postgres runs in the `agentic-pg` container and Playwright in `pw-server`. Task 0 checks both.
- Known flaky e2e specs, rerun alone before debugging: `sync.spec.ts:105` (phone), `ask-prompts.spec.ts:88`
  (desktop), `offline.spec.ts:30` (desktop).

## Architecture Decisions

- **One config surface, one type.** `InstanceLimits` and `DEFAULT_LIMITS` live in `src/shared/limits/limits.ts`.
  `parseConfig` returns `limits: InstanceLimits`. `getMyBooksPage`, `articlesState` and the account page's `storage`
  all send that same object, whole, so the browser never rebuilds a limit from parts. The wire changes are additive:
  quota answers keep `409 { error: 'quota', scope, max }`, and the one new answer is
  `413 { error: 'article-too-large', max }` for articles. Books keep `413 { error: 'book-too-large' }`.
- **Store functions take the whole `limits` object, required, with no default.** `startImport(pool, userId, book,
  now, limits, article?)`, `startAudiobook(pool, userId, book, now, limits)`, `storeImage(…, image, limits)` and
  `storeChapter(…, chapter, limits)`. One object rules out swapping two bare numbers (25 books and 500 articles have
  the same type), and having no default keeps `DEFAULT_LIMITS` out of production code, as the spec says. `now` loses
  its default where `limits` follows it. `ArticleStart` loses `max`, because `limits.articles` replaces it. Only
  handlers call `getConfig()`.
- **The shared parser and planner take a number.** `parseAudiobookStart(value, maxBytes, now?)` and
  `BOOK_ROOM(userBytesLeft)` (now required) take just the number they check, because they're pure helpers that the
  browser runs too.
- **Validate once, at the boundary.** `parseLimits` runs inside `parseConfig` and throws a `ConfigError` naming the
  variable. Nothing downstream re-checks a limit's shape.
- **Slice per cap.** After the config foundation, each task takes one cap from env to refusal to message: the
  handler reads config, the store function checks it, the browser reads it from loader data, the copy names it, and
  the constant is deleted. Deleting the constant at the end of its task makes the compiler find any reader that was
  missed.
- **The riskiest cap goes first.** The new article text cap is the only new behaviour, and the only one that deletes
  rows. It's Task 3, right after the foundation, so a problem shows up before the mechanical work.
- **Copy uses the refusal's `max`, and falls back to loader limits only for checks made before any upload.** A cached
  page can hold stale limits, but a server refusal is always current.
- **Built in one go, reviewed once at the end.** Checkpoints are self-checks: if one fails, fix it and re-run it.
  Anything only the owner can do goes in "Needs owner action" in the todo, and the build carries on.

## Task List

### Phase 1: The config surface
- [ ] Task 0: Preflight
- [ ] Task 1: `InstanceLimits`, `DEFAULT_LIMITS` and `parseLimits`
- [ ] Task 2: One `formatBytes`

### Checkpoint: Config surface
- [ ] `pnpm check` and `pnpm test:db` pass, with coverage at or above the Task 0 baseline

### Phase 2: The caps, one at a time
- [ ] Task 3: Article text cap (`LIMIT_ARTICLE_TEXT`, new)
- [ ] Task 4: Books per user (`LIMIT_BOOKS`)
- [ ] Task 5: Saved articles (`LIMIT_ARTICLES`)

### Checkpoint: Text caps
- [ ] `MAX_BOOKS` and `MAX_ARTICLES` are gone; `pnpm check`, `pnpm test:db` and the named e2e specs pass

### Phase 2, continued
- [ ] Task 6: Picture storage per user (`LIMIT_USER_PICTURES`)
- [ ] Task 7: One audiobook's size (`LIMIT_AUDIOBOOK_SIZE`)
- [ ] Task 8: Audio per user (`LIMIT_USER_AUDIO`)

### Checkpoint: Every cap configurable
- [ ] The spec's leftover `git grep` prints nothing; `pnpm check`, `pnpm test:db` and the named e2e specs pass

### Phase 3: The reader's view, and finishing
- [ ] Task 9: Storage section, with the hosted values in e2e
- [ ] Task 10: Proof matrix, startup check, full runs and commit

### Checkpoint: Complete
- [ ] Every success criterion the build can check is met, and the rest are in "Needs owner action"

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A refused article's delete leaves a picture behind, or deletes the wrong row | High | The delete is keyed on the row `storeChapter` already locked (`id` and `user_id`, status `uploading`). A db test checks that the row, its chapters and its pictures are gone, that `imageBytesUsed` and `countedArticles` drop back, and that a book of the same size is stored. |
| A picture upload for the same article is in flight when the chapter is refused | Low | The client uploads every picture before the first chapter and stops on the first failure. A late picture insert would fail its foreign key and answer an error to a save that has already failed. |
| The browser and server disagree after an operator changes a limit | Low | The server always checks. Refusal messages use the response's `max`. |
| Coverage drops below a floor because new branches go untested | Med | Task 0 records the baseline totals. Each checkpoint compares them, and each new branch (`parseLimits`'s cases, the article cap, the delete, the picture-room fix) has a test. No floor is lowered. |
| `articles/actions.ts` (100% floor) loses a line | Low | `articlesState` only adds a field. The checkpoint runs `pnpm test:db` with per-file floors. |
| About 105 store call sites change, and a test passes the wrong limits | Low | Seeding calls pass `DEFAULT_LIMITS`. Only the tests about a cap pass small limits. The compiler finds every call. |
| The owner's account on production is already over 1 GB of audio | Low | Nothing is deleted. The owner is refused only on the next upload, and can raise the hosted value. "Needs owner action" says so. |
| A typo in a variable name (`LIMITS_USER_AUDIO`) is ignored silently | Low | The Storage section shows the values in effect, and the owner's check after deploy reads it. A warning for unknown names is out of scope. |
| A flaky e2e spec fails a full run | Low | Rerun it alone before debugging. |

## Decisions

Made in this plan, approved by the owner 2026-11-26:

1. **One `formatBytes`, moved to `src/shared/lib/format-bytes.ts`.** The client's `formatBytes` in
   `src/client/lib/format.ts` is moved there, and its output becomes the spec's: the largest unit of KB, MB or GB
   that keeps the number at 1 or more, one decimal, with `.0` dropped (`512 KB`, `100 MB`, `1.5 GB`). It keeps the
   current rule that anything from 1 byte to 1 KB shows as `1 KB`, and `0` prints `0 KB`. `DownloadButton.tsx` imports
   the shared one, so "Downloaded · 1.0 MB" becomes "Downloaded · 1 MB", and its tests move to
   `format-bytes.test.ts`. `BookImporter`'s local `megabytes` goes. The voices' `megabytes` stays. *The alternative
   is to keep the client one and give the new one another name, which leaves two byte formatters with two styles.*
2. **The account page's `storage` adds `audiobooks: boolean`,** so the Storage section can hide the audio line as the
   importer does.
3. **A book or article with no pictures is never refused for picture room.** `startImport` refuses on room only when
   `images.bytes > 0 && images.bytes > left`. That's the spec's "only an upload that would add to a full cap" rule,
   which the current code would break once a limit is lowered.
4. **The startup check runs against `pnpm start`, not `pnpm dev`:**
   `pnpm build && LIMIT_USER_AUDIO=1 pnpm start` exits 1 and prints `LIMIT_USER_AUDIO`. `pnpm dev` checks config on
   the first request, not at start, and this module doesn't change that.
5. **Handler wiring is proven in one new db test file**, `src/server/instance-limits.db.test.ts`, which mocks
   `getConfig` with a mutable `limits` object, one case per cap. Store tests pass small limits directly.
6. **One local commit on `main`, not pushed.** CODE_STANDARDS.md asks for renames of unclear names in a separate
   commit. If the build renames anything, the renames go in a second commit after the first, using TypeScript's
   language-server rename (`tsc --lsp --stdio`, `textDocument/rename`, as in billing-removal), never find-and-replace.
   If nothing needs renaming, there's one commit.

From the spec and the map, not reopened: `LIMIT_*` names, binary units, a bad value stops the server, limits travel
in loader data, the article cap is measured like the book cap, no admin exemption, nothing is deleted when a limit is
lowered, and `.env.example` and the README belong to `contributor-docs`.

## Open Questions

None.
