# Spec: instance-limits — V1

Status: approved (2026-11-25)

Module of [capability-map.md](capability-map.md). It depends on `billing-removal` and starts from the code that
module leaves behind. `contributor-docs` depends on it.

## Objective

Make the six storage caps from the map's **Hosted limits** table into operator config. Each one has a default equal
to today's Pro value, so a self-hoster who sets nothing gets what Pro has now. agenticlibrary.app sets lower values
for audio and pictures. Add a new cap on the stored text of one saved article. Show each reader their usage against
the limits, and document the settings for operators.

**Who it's for:**

- **The owner, as operator of agenticlibrary.app.** Open sign-up turns the 8 GB audio cap into a hosting cost and an
  abuse risk. The owner needs to lower it without a code change.
- **Self-hosters,** who get sensible defaults and can raise or lower any cap.
- **Readers,** who see how much room they have before an upload fails.

**What success looks like:** with no `LIMIT_*` variable set, every limit is today's Pro value. With the hosted values
set, the server and the browser both refuse an upload past 1 GB of audio or 100 MB of pictures, and the message
names the configured value. The account page shows usage against the configured limits. An article over 1 MB of
stored text is refused, and nothing half-saved is left behind.

## What the code does today

Facts gathered 2026-11-25. This module starts after `billing-removal`, so `limitsFor`, `PRO_LIMITS` and `plan` are
already gone, and `PRO_ARTICLES` has been renamed `MAX_ARTICLES`.

| Cap | Constant | Defined in | Checked on the server | Checked or shown in the browser |
|---|---|---|---|---|
| Audio per user | `MAX_USER_AUDIO_BYTES` (8 GB) | [audiobooks/limits.ts](../src/shared/audiobooks/limits.ts) | `startAudiobook` in [audiobooks/store.ts](../src/server/audiobooks/store.ts) | [read-audiobook.ts](../src/client/features/audiobook-import/read-audiobook.ts), and "8 GB" is hard-coded in [audiobook-problems.ts](../src/client/features/audiobook-import/audiobook-problems.ts) |
| One audiobook | `MAX_AUDIOBOOK_BYTES` (2 GB) | same | `parseAudiobookStart` in [audiobooks/input.ts](../src/shared/audiobooks/input.ts) | `read-audiobook.ts`, and "2 GB" is hard-coded in `audiobook-problems.ts` |
| Pictures per user | `MAX_USER_IMAGE_BYTES` (250 MB) | [import/limits.ts](../src/shared/import/limits.ts) | `startImport` in [user-books.ts](../src/server/user-books.ts) and the picture upload in [book-images/store.ts](../src/server/book-images/store.ts) | [BookImporter.tsx](../src/client/features/import/BookImporter.tsx), [article-save.ts](../src/client/features/articles/article-save.ts), `BOOK_ROOM` in [draft.ts](../src/shared/import/draft.ts) |
| Books per user | `MAX_BOOKS` (25) | `import/limits.ts` | `startImport`, `startAudiobook` | the quota copy in [import-problems.ts](../src/client/features/import/import-problems.ts) and `audiobook-problems.ts` |
| Saved articles | `MAX_ARTICLES` (500) | [articles/contract.ts](../src/shared/articles/contract.ts) | `startImport` (the `article` branch), through `handleNewBook` in [book-actions.ts](../src/server/book-actions.ts) | `max` is already sent in `articlesState` |
| Text of one article | none. Articles are books with `article_url` set, so today they get the 8 MB book cap, `MAX_BOOK_HTML_BYTES` | — | `storeChapter` in `user-books.ts`, for books | `book-too-large` copy says "8 MB" |

Other facts:

- **Config** is parsed once by `parseConfig` in [config.ts](../src/server/config.ts). A bad value throws
  `ConfigError`, and the server refuses to start. Every other setting works this way.
- **Usage already reaches the browser.** `getMyBooksPage` in [account-functions.ts](../src/server/account-functions.ts)
  returns `imageBytesUsed`, `audioBytesUsed` and `bookCount`. `articlesState` in
  [articles/actions.ts](../src/server/articles/actions.ts) returns `imageBytesUsed` and `max`.
- **Quota refusals carry `max`:** `409 { error: 'quota', scope, max }`. The scopes are `books`, `articles`, `audio` and
  `user` (pictures).
- **"Stored text"** is `user_books.html_bytes`, the sum of `octet_length` over the rendered, paginated pages. It is
  the same measure the 8 MB book cap uses.
- **A refused upload stays behind as `status = 'uploading'`** until `sweepStaleUploads` deletes it after
  `STALE_UPLOAD_HOURS` (24). For an article, that row counts against `countedArticles` until it's swept.
  `findArticle` only matches `ready` rows, so a retry isn't blocked.
- **Constants that stay constants:** `MAX_BOOK_HTML_BYTES` (8 MB a book), `MIN_FREE_BYTES` (10 GB of free disk),
  `MIN_FREE_BYTES_UPLOADING`, `MAX_BOOK_IMAGE_BYTES` (30 MB a book), `MAX_IMAGE_BYTES`, `MAX_AUDIO_FILES`, and every
  row-count limit (highlights, flashcards, bookmarks, shelves, prompts), as the map decided.
- **No schema change is needed.** Every limit is checked against data that's already stored.

## What changes

### 1. Settings

Six new environment variables. Each is optional. Unset or empty means the default.

| Variable | Limits | Default | agenticlibrary.app |
|---|---|---|---|
| `LIMIT_USER_AUDIO` | audiobook storage per user, all audiobooks combined | `8GB` | `1GB` |
| `LIMIT_AUDIOBOOK_SIZE` | the size of one audiobook | `2GB` | `1GB` |
| `LIMIT_USER_PICTURES` | picture storage per user, books and articles combined | `250MB` | `100MB` |
| `LIMIT_BOOKS` | books per user, audiobooks included | `25` | `25` |
| `LIMIT_ARTICLES` | saved articles per user | `500` | `500` |
| `LIMIT_ARTICLE_TEXT` | stored text of one article (**new**) | `1MB` | `1MB` |

**Format.** A size is a whole number followed by `KB`, `MB` or `GB`, in any case, with an optional space: `1GB`,
`100 MB`. Units are binary, as everywhere else in the code, so `1GB` is 1024³ bytes. A count is a whole number. A bare
number for a size is refused, so `LIMIT_USER_AUDIO=1` can't silently mean one byte.

**Validation.** The server refuses to start with a `ConfigError` that names the variable when:

- a value isn't in the format above, or is zero;
- `LIMIT_AUDIOBOOK_SIZE` is larger than `LIMIT_USER_AUDIO`, because no audiobook could be uploaded at that size;
- `LIMIT_ARTICLE_TEXT` is larger than 8 MB (`MAX_BOOK_HTML_BYTES`), because an article is stored as a book;
- a size is larger than `Number.MAX_SAFE_INTEGER` bytes.

There's no other upper bound. An operator may set `LIMIT_BOOKS=1000`.

`parseConfig` returns them as `limits: InstanceLimits`:

```ts
export interface InstanceLimits {
  userAudioBytes: number
  audiobookBytes: number
  userPictureBytes: number
  books: number
  articles: number
  articleTextBytes: number
}
```

`InstanceLimits` and `DEFAULT_LIMITS` live in a new `src/shared/limits/limits.ts`, because the browser needs the type.
**`MAX_USER_AUDIO_BYTES`, `MAX_AUDIOBOOK_BYTES`, `MAX_USER_IMAGE_BYTES`, `MAX_BOOKS` and `MAX_ARTICLES` are deleted.**
Every read goes through `getConfig().limits` on the server, or the loader data in the browser. Deleting them turns
every use that gets missed into a type error. `DEFAULT_LIMITS` is read only by `parseConfig` and by tests.

### 2. Server

- Store functions take the limit they check as a parameter, as `startImport` and `startAudiobook` already do for
  `maxBooks`. Handlers pass `getConfig().limits`. Store functions never call `getConfig()` themselves, so db tests can
  pass small limits.
- `startAudiobook` checks `limits.books` and `limits.userAudioBytes`. The audiobook start parser in
  `shared/audiobooks/input.ts` takes the audiobook size cap as an argument.
- `startImport` and the picture upload in `book-images/store.ts` check `limits.userPictureBytes`. `startImport` checks
  `limits.books`, or `limits.articles` for an article.
- **New article text check.** `storeChapter` reads `article_url` with the row it already locks. For an article, a
  running total over `limits.articleTextBytes` returns `'article-too-big'`, and books keep the 8 MB check. When the
  chapter is refused, the same transaction deletes the half-saved article and its pictures. So it doesn't count
  against the article quota for 24 hours, and its pictures don't count against picture storage. `handleChapter`
  answers `413 { error: 'article-too-large', max }`.
- **Lowering a limit never deletes anything.** A reader already past a lowered limit keeps everything, and can read,
  export and delete it. Only an upload that would add to a cap that's already full is refused. That includes
  articles already over 1 MB.

### 3. Wire contracts

| Response | Today (after `billing-removal`) | After |
|---|---|---|
| Quota refused | `409 { error: 'quota', scope, max }`, where `max` is a constant | same shape. `max` is the configured value. |
| Article chapter too large | `413 { error: 'book-too-large' }` above 8 MB | `413 { error: 'article-too-large', max }` above `limits.articleTextBytes`. Books are unchanged. |
| `getMyBooksPage` | `imageBytesUsed`, `audioBytesUsed`, `bookCount`, … | adds `limits: InstanceLimits` |
| `articlesState` (`ready`) | `max`, `imageBytesUsed`, … | adds `limits: InstanceLimits`. `max` stays and equals `limits.articles`. |
| Account page loader | — | adds `storage: { bookCount, articleCount, audioBytes, pictureBytes, limits }` |

The limits aren't secret. Any signed-in reader can see them.

### 4. Browser

- `BookImporter`, `AudiobookImporter`/`read-audiobook`, `SaveArticleForm`/`article-save` and `BOOK_ROOM` read limits
  from props filled by the loader data, not from imports.
- Copy names the configured value through one formatter, `formatBytes` in `src/shared/lib/`, which prints `1 GB`,
  `100 MB` or `1.5 GB`. It replaces the local `megabytes()` in `BookImporter.tsx`. Examples:
  - "This audiobook is larger than 1 GB."
  - "Your audiobooks would go over 1 GB. Delete one to make room."
  - "Your library holds up to 25 books. Delete one to import another."
  - "This article is over 1 MB of text, the most an article can hold."
- A quota refusal's message uses `max` from the response, so it's right even when the browser's limits are stale,
  for example in an offline-cached page.
- **Account page: a new Storage section.** It takes the place `PlanSection` had before `billing-removal`, with four
  lines and a `<meter>` each: books, saved articles, audiobook storage and picture storage, such as "3 of 25 books"
  and "412 MB of 1 GB of audiobooks". Usage past a lowered limit shows a full meter and the line "over the limit,
  delete some to add more". Audiobook storage is hidden when audiobooks are off (`AUDIOBOOKS_DIR` unset), as the
  importer already is.

### 5. Documentation

- **This spec's settings table** is the source for `contributor-docs`. That module writes the six variables, with
  their defaults and a comment giving the agenticlibrary.app values, into `.env.example`, and adds a short "Limits"
  section to the README. This module doesn't create those files, because `contributor-docs` owns them.
- **For readers,** the Storage section shows the limits that apply. Since it reads config, it can't drift from what
  the server enforces.
- [capability-map.md](capability-map.md)'s Hosted limits table gains a column with the variable names.

## Cut-over

1. Merge sections 1 to 5. With no `LIMIT_*` set, behaviour is the same as after `billing-removal`, except for the new
   1 MB article cap. CI goes green and it deploys to dev.
2. **Owner step (map Assumption 5):** add the hosted values to the env files on the server, for production and for
   dev, so dev matches production:
   ```
   LIMIT_USER_AUDIO=1GB
   LIMIT_AUDIOBOOK_SIZE=1GB
   LIMIT_USER_PICTURES=100MB
   ```
   The other three are left unset, because their defaults are the hosted values.
3. Restart. Check that the Storage section on the account page says "of 1 GB" and "of 100 MB" on dev and production.
4. Before `go-public` sets `SIGNUP=open`, the hosted values must be live on production. `go-public`'s checks repeat
   step 3.

## Commands

```
pnpm check                                          Lint, types, unit tests
pnpm test:db                                        Database tests
pnpm e2e:local                                      End-to-end on desktop, phone and tablet
git grep -nE 'MAX_USER_AUDIO_BYTES|MAX_AUDIOBOOK_BYTES|MAX_USER_IMAGE_BYTES|\bMAX_BOOKS\b|\bMAX_ARTICLES\b|8 GB|2 GB|250 MB' -- src scripts tests
                                                    Leftover check; expected to print nothing
LIMIT_USER_AUDIO=1 pnpm dev                         Should refuse to start, naming LIMIT_USER_AUDIO
```

## Files

```
src/shared/limits/limits.ts            new: InstanceLimits, DEFAULT_LIMITS
src/shared/lib/format-bytes.ts         new: formatBytes (+ test)
src/server/config.ts                   parseLimits, limits field (+ config.test.ts)
src/shared/import/limits.ts            MAX_BOOKS, MAX_USER_IMAGE_BYTES removed
src/shared/audiobooks/limits.ts        MAX_USER_AUDIO_BYTES, MAX_AUDIOBOOK_BYTES removed
src/shared/articles/contract.ts        MAX_ARTICLES removed; ArticlesState gains limits
src/shared/audiobooks/input.ts         takes the audiobook cap
src/shared/import/draft.ts             BOOK_ROOM takes the picture cap
src/server/user-books.ts               startImport, storeChapter (article text check)
src/server/book-images/store.ts        picture cap as a parameter
src/server/audiobooks/store.ts, actions.ts
src/server/book-actions.ts             handleNewBook, handleChapter
src/server/articles/actions.ts         articlesState
src/server/account-functions.ts        getMyBooksPage, account page storage
src/client/features/import/            BookImporter, import-problems, import-client
src/client/features/audiobook-import/  AudiobookImporter, read-audiobook, audiobook-problems
src/client/features/articles/          SaveArticleForm, article-save, article messages
src/client/features/account/StorageSection.tsx   new
src/routes/account/index.tsx, account/books/index.tsx
tests/e2e/support/test-server.ts       runs with the hosted values
tests/e2e/specs/account.spec.ts, articles.spec.ts
spec/capability-map.md                 Hosted limits table gains variable names
```

## Code style

Follow [CODE_STANDARDS.md](../CODE_STANDARDS.md): descriptive names, `/** */` comments, and no `any`. Parse in the
same style as the rest of `config.ts`:

```ts
/** Sizes are binary, as in the rest of the code: 1GB is 1024³ bytes. */
const SIZE_UNITS = { KB, MB, GB } as const
const SIZE = /^(\d{1,7}) ?(KB|MB|GB)$/i

function parseSize(value: string | undefined, name: string, fallback: number): number {
  const text = value?.trim()
  if (!text) return fallback
  const match = SIZE.exec(text)
  const unit = match?.[2]?.toUpperCase() as keyof typeof SIZE_UNITS | undefined
  const bytes = match && unit ? Number(match[1]) * SIZE_UNITS[unit] : 0
  if (!bytes || !Number.isSafeInteger(bytes))
    throw new ConfigError(`${name} must be a size such as 500MB or 2GB, got "${value}"`)
  return bytes
}
```

Store functions take the limit, and handlers pass the config:

```ts
const { limits } = getConfig()
const started = await startAudiobook(db, userId, book, new Date(), limits)
if (!started.ok) return fail(409, 'quota', { scope: started.quota, max: started.max })
```

When a function's names are touched and some are unclear, rename them in a separate commit, as CODE_STANDARDS.md says.

## Testing strategy

- **Unit (Vitest, `pnpm check`):**
  - `config.test.ts`: with nothing set, `limits` equals `DEFAULT_LIMITS`, which equals today's Pro values. The hosted
    values parse to the right byte counts. `1gb` and `100 MB` parse. A bare `1`, `0GB`, `1TB`, `-5`, a fractional
    size, `LIMIT_AUDIOBOOK_SIZE` above `LIMIT_USER_AUDIO`, and `LIMIT_ARTICLE_TEXT=9MB` are each refused, with the
    variable named.
  - `format-bytes.test.ts`: `1 GB`, `100 MB`, `1.5 GB` and `512 KB`.
  - `read-audiobook`, `audiobook-problems`, `import-problems` and `draft` tests pass limits in, and check that
    messages name the configured value, not 8 GB, 2 GB or 250 MB.
- **Database (`pnpm test:db`):** each store test passes small explicit limits, such as 3 articles or 2 books, instead
  of filling to 500. For each of the six limits, one test shows that an upload at the limit succeeds and the next is
  refused with that `max`. For `storeChapter`, an article over `articleTextBytes` is refused and its row and pictures
  are gone, while a book of the same size is stored. A reader already over a lowered limit can still delete a book,
  and the next upload is refused.
- **End to end (`pnpm e2e:local`):** `test-server.ts` runs with the hosted values. `account.spec.ts` checks that the
  Storage section reads "of 1 GB" and "of 100 MB" and counts an imported book. `articles.spec.ts` serves an
  over-1 MB article from the existing article test host and checks the refusal message.
- **Leftover check:** the `git grep` in Commands prints nothing.
- **Coverage floors don't go down.**
- **Known flaky specs:** `sync.spec.ts:105` on phone and `ask-prompts.spec.ts:88` on desktop. Rerun them before
  debugging.

## Boundaries

- **Always:**
  - read limits from `getConfig().limits` in handlers and pass them into store functions;
  - check every limit on the server, even where the browser checks first;
  - name the configured value in every message, never a hard-coded number;
  - keep today's Pro values as the defaults.
- **Ask first:**
  - making any other constant configurable, such as the 8 MB book cap, `MIN_FREE_BYTES` or a row-count limit;
  - changing a default;
  - adding a schema change or migration;
  - an admin exemption or per-user overrides. Both were decided against for V1.
- **Never:**
  - delete or hide a reader's existing content because a limit was lowered;
  - change the server's env files. That's the owner's step;
  - write `.env.example` or the README. That's `contributor-docs`.

## Success criteria

- [ ] With no `LIMIT_*` set, `getConfig().limits` equals 8 GB, 2 GB, 250 MB, 25, 500 and 1 MB.
- [ ] Each of the six variables changes the limit that the server enforces and that the browser shows, shown by a
      test for each.
- [ ] A malformed, zero or inconsistent value stops the server at start, with a message naming the variable.
- [ ] With the hosted values set, an audiobook over 1 GB, audio past 1 GB in total, and pictures past 100 MB are
      refused in the browser before any upload, and by the server if the browser is bypassed.
- [ ] Every quota message names the configured value. The leftover `git grep` prints nothing.
- [ ] An article over 1 MB of stored text gets `413 { error: 'article-too-large', max }`. Its row and pictures are
      deleted, and the reader sees the article message.
- [ ] A reader over a lowered limit keeps all their content, can delete it, and is refused only on new uploads.
- [ ] The account page has a Storage section showing books, articles, audio and pictures against the configured
      limits, with the audio line hidden when audiobooks are off.
- [x] The capability map's Hosted limits table lists the variable names (done 2026-11-25, with the spec's approval).
- [ ] After the owner's step, dev and production show "of 1 GB" and "of 100 MB" on the account page.
- [ ] `pnpm check`, `pnpm test:db` and `pnpm e2e:local` pass, with no coverage floor lowered.

## Risks

- **Browser and server disagree.** A cached page may hold old limits after the operator changes them. Mitigation:
  the server always checks, and refusal messages use the `max` in the response.
- **The owner's own account may already be over 1 GB of audio** on production. Mitigation: nothing is deleted. The
  owner is refused only on the next upload, and can raise the hosted value. There is no admin exemption (see
  Decisions).
- **Articles over 1 MB that are already saved** stay as they are. Only new saves are checked.
- **A refused article leaves its pictures uploaded.** Mitigation: the refusal deletes the row and its pictures in
  the same transaction, and a db test checks it.
- **Typo in a variable name** (`LIMITS_USER_AUDIO`) is silently ignored, and the default applies. Mitigation: the
  Storage section shows the values in effect, and Cut-over step 3 checks them. A warning for unknown `LIMIT_*`
  names is deferred.

## Out of scope (deferred)

- Per-user overrides or an admin exemption: one set of limits for everyone in V1.
- Making the row-count limits (highlights, flashcards, bookmarks, shelves, prompts) configurable: the map keeps them
  as constants.
- Making the 8 MB book text cap, `MIN_FREE_BYTES` or the per-book picture cap configurable: not needed for hosting
  cost.
- Stating the limits on the signed-out home page or in the FAQ: `legal-and-attribution` may cover them in the Terms.
- An admin view of every user's usage.
- A start-up warning for unknown `LIMIT_*` variables.
- Writing `.env.example` and the README "Limits" section: `contributor-docs`.

## Changes to other specs

Made in this session:

- **Capability map:** the Progress row for `instance-limits` is marked approved, and `legal-and-attribution` is
  next. The Hosted limits table gains the variable names.

Inherited by later specs:

- **`contributor-docs`** writes the six variables into `.env.example` and a "Limits" README section from the
  settings table above.
- **`go-public`** checks before `SIGNUP=open` that production shows the hosted values on the account page.

## Decisions

- **Variables are named `LIMIT_*`.** Sizes need a unit, and units are binary (`1GB` is 1024³ bytes). *(2026-11-25)*
- **A bad value stops the server**, as every other setting does. *(2026-11-25)*
- **Limits travel to the browser in the loader data** that already carries usage. There's no new endpoint.
  *(2026-11-25)*
- **The new article text cap is measured like the book cap** (`html_bytes`), and a refusal deletes the half-saved
  article and its pictures. *(2026-11-25)*
- **The Storage section on the account page** is the reader-facing record of the limits in effect. *(2026-11-25)*
- **No admin exemption.** The owner's admin account is held to the same limits as everyone. One rule is simpler, and
  the owner can raise the hosted value. *(2026-11-25)*

## Open questions

None.
