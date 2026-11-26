# Tasks: instance-limits

Plan: [tasks/instance-limits-plan.md](instance-limits-plan.md) · Spec: [spec/SPEC-instance-limits.md](../spec/SPEC-instance-limits.md)

Boundaries that apply to every task: each cap's default stays today's value (8 GB, 2 GB, 250 MB, 25, 500), and the
new article cap defaults to 1 MB. Don't make any other constant configurable: `MAX_BOOK_HTML_BYTES`,
`MIN_FREE_BYTES`, `MIN_FREE_BYTES_UPLOADING`, `MAX_BOOK_IMAGE_BYTES`, `MAX_IMAGE_BYTES`, `MAX_AUDIO_FILES` and the
row-count limits stay as they are. Don't add a migration or edit an applied one, and don't lower a coverage floor.
Never delete or hide a reader's existing content because a limit is lower. Never touch the server's env files, and
don't write `.env.example` or the README (that's `contributor-docs`). Store functions never call `getConfig()`, only
handlers do. Follow [CODE_STANDARDS.md](../CODE_STANDARDS.md): descriptive names, `/** */` comments, no `any`. Don't
edit `src/routeTree.gen.ts` by hand.

**How this is built:** in one go, from Task 0 to Task 10. The owner reviews the finished work once, at the end. The
checkpoints are self-checks: if one fails, fix it and re-run it before going on, and don't stop to ask. Anything that
needs the owner goes in the **"Needs owner action"** list at the bottom of this file, and the build carries on. Nothing
in that list is done on the owner's behalf.

**What every cap task does.** The handler passes `getConfig().limits`. The store function checks the limit and answers
its `max`. The browser reads the limit from loader data, and a refusal's message uses the response's `max`. The copy
names the value through `formatBytes`, or as a count. The constant is deleted. The store test passes small limits and
shows an upload at the limit succeeds and the next is refused with that `max`. A case in
`src/server/instance-limits.db.test.ts` shows the configured value reaching the handler's refusal.

**Leftover check**, run at the third checkpoint and in Task 10. It's the spec's command, and it must print nothing:

```
git grep -nE 'MAX_USER_AUDIO_BYTES|MAX_AUDIOBOOK_BYTES|MAX_USER_IMAGE_BYTES|\bMAX_BOOKS\b|\bMAX_ARTICLES\b|8 GB|2 GB|250 MB' -- src scripts tests
```

**Per-task verification:** `pnpm check` (lint, types, unit tests with coverage) and `pnpm test:db`, plus the e2e specs
the task names, run on desktop with `pnpm e2e:local --project=desktop <spec>`. The full e2e run is in Task 10.

---

## Task 0: Preflight

**Description:** Before any work, confirm the build can run from start to end. `git status` is clean on `main`, and
`main` matches `origin/main`. Postgres (`agentic-pg`) answers, and `pnpm check` and `pnpm test:db` pass on the
untouched tree. Record the four coverage totals from each run in `$SCRATCH/baseline.txt`. Run `account.spec.ts` on
desktop, and `pnpm build`. Run the leftover check and record that it matches 23 files. If any of these fails, stop now
and say what's wrong. This is the only stop, and it comes before any work.

**Acceptance criteria:**
- [ ] `git status` is clean on `main`, and `git log origin/main..main` is empty
- [ ] `pnpm check` and `pnpm test:db` pass, and their coverage totals are recorded
- [ ] `pnpm build` succeeds and `account.spec.ts` passes on desktop

**Verification:**
- [ ] `$SCRATCH/baseline.txt` holds unit and server statements, branches, functions and lines

**Dependencies:** None

**Files likely touched:** none (the scratch baseline only)

**Estimated scope:** XS

---

## Task 1: `InstanceLimits`, `DEFAULT_LIMITS` and `parseLimits`

**Description:** Add `src/shared/limits/limits.ts` with the spec's `InstanceLimits` and
`DEFAULT_LIMITS = { userAudioBytes: 8 GB, audiobookBytes: 2 GB, userPictureBytes: 250 MB, books: 25, articles: 500,
articleTextBytes: 1 MB }`, built from the existing `KB`, `MB` and `GB`. In `config.ts`, add `parseSize` and
`parseCount` in the spec's style, and `parseLimits(env)`, which reads the six `LIMIT_*` variables (unset or empty
means the default) and throws a `ConfigError` naming the variable for: a value not in the format, zero, a size above
`Number.MAX_SAFE_INTEGER` bytes, `LIMIT_AUDIOBOOK_SIZE` above `LIMIT_USER_AUDIO`, and `LIMIT_ARTICLE_TEXT` above
`MAX_BOOK_HTML_BYTES`. `Config` gains `limits`. Nothing reads it yet. The old constants stay until their tasks.

**Acceptance criteria:**
- [ ] With no `LIMIT_*` set, `parseConfig({}).limits` equals `DEFAULT_LIMITS`, and `limits.test.ts` pins
      `DEFAULT_LIMITS` to 8 GB, 2 GB, 250 MB, 25, 500 and 1 MB in bytes
- [ ] The hosted values (`1GB`, `1GB`, `100MB`) parse to 1024³, 1024³ and 100 × 1024² bytes, and `1gb` and `100 MB`
      parse
- [ ] A bare `1`, `0GB`, `1TB`, `-5`, `1.5GB`, `LIMIT_BOOKS=0`, `LIMIT_BOOKS=abc`, `LIMIT_AUDIOBOOK_SIZE=4GB` with
      the default `LIMIT_USER_AUDIO`, and `LIMIT_ARTICLE_TEXT=9MB` each throw a `ConfigError` whose message names the
      variable

**Verification:**
- [ ] `pnpm check`, `pnpm test:db` (config.ts's new branches all covered)

**Dependencies:** Task 0

**Files likely touched:** `src/shared/limits/limits.ts` (new), `src/shared/limits/limits.test.ts` (new),
`src/server/config.ts`, `src/server/config.test.ts`

**Estimated scope:** S

---

## Task 2: One `formatBytes`

**Description:** Plan Decision 1. Add `src/shared/lib/format-bytes.ts` with `formatBytes`. It picks the largest unit
of KB, MB and GB that keeps the number at 1 or more, shows one decimal and drops `.0`. Anything from 1 byte to 1 KB is
`1 KB`, and `0` is `0 KB`. Remove `formatBytes` from `src/client/lib/format.ts`. `DownloadButton.tsx` imports the
shared one, and the `formatBytes` cases move from `format.test.ts` to `format-bytes.test.ts`, updated where `.0`
goes.

**Acceptance criteria:**
- [ ] `formatBytes` gives `1 GB`, `100 MB`, `1.5 GB`, `512 KB`, `412 MB`, `1 KB` for 1536 bytes (rounded as today) and
      `0 KB` for 0 (`format-bytes.test.ts`)
- [ ] Only one `formatBytes` exists (`git grep -n 'function formatBytes' -- src`)
- [ ] The offline download control still shows "Downloaded · N MB"

**Verification:**
- [ ] `pnpm check`
- [ ] `offline.spec.ts` on desktop (rerun alone if `offline.spec.ts:30` flakes)

**Dependencies:** Task 0

**Files likely touched:** `src/shared/lib/format-bytes.ts` (new), `src/shared/lib/format-bytes.test.ts` (new),
`src/client/lib/format.ts`, `src/client/lib/format.test.ts`, `src/client/features/offline/DownloadButton.tsx`

**Estimated scope:** S

---

## Checkpoint: Config surface (after Tasks 1–2, self-check)
- [ ] `pnpm check` and `pnpm test:db` pass, with coverage at or above the Task 0 baseline
- [ ] `git grep -n 'getConfig' -- src/server/user-books.ts src/server/book-images/store.ts src/server/audiobooks/store.ts`
      finds nothing (store functions don't read config)
- [ ] If not, fix and re-run before going on

---

## Task 3: Article text cap (`LIMIT_ARTICLE_TEXT`, new)

**Description:** `storeChapter` gains a required `limits` parameter, and every call passes one: `DEFAULT_LIMITS` in
tests that only seed a book, and `getConfig().limits` in `handleChapter`. Its locked select adds `article_url`. For an
article, a running total over `limits.articleTextBytes` deletes the `user_books` row in the same transaction (chapters
and pictures go with it by cascade) and returns `'article-too-big'`. Books keep the `MAX_BOOK_HTML_BYTES` check and
`'too-big'`. `handleChapter` answers `413 { error: 'article-too-large', max }`. On the client, `import-client` knows
`article-too-large` and keeps its `max`, `private-book-save` passes it through, and `article-save` turns it into a new
article problem whose copy is "This article is over 1 MB of text, the most an article can hold." with the value from
`max`. `articles-stub.ts` gains a `long` page, built in code, of between 1 MB of rendered text and 5 MB of source.
Create `src/server/instance-limits.db.test.ts` (plan Decision 5) with this cap's case.

**Acceptance criteria:**
- [ ] A db test with `articleTextBytes` small: an article at the cap is stored, and one over it gets `'article-too-big'`.
      Its row, chapters and pictures are gone, and `imageBytesUsed` and `countedArticles` are back where they were. A
      book of the same size is stored.
- [ ] The handler answers `413 { error: 'article-too-large', max }` with the mocked config's value
      (`instance-limits.db.test.ts`), and a book over 8 MB still gets `413 { error: 'book-too-large' }`
- [ ] `articles.spec.ts` saves the `long` page, and sees the article message naming 1 MB. The article isn't in the list
      afterwards.

**Verification:**
- [ ] `pnpm check`, `pnpm test:db`
- [ ] `articles.spec.ts` on desktop

**Dependencies:** Tasks 1–2

**Files likely touched:** `src/server/user-books.ts`, `src/server/book-actions.ts`,
`src/server/instance-limits.db.test.ts` (new), `src/server/user-books.db.test.ts`,
`src/client/features/import/{import-client,private-book-save}.ts`,
`src/client/features/articles/{article-save,article-messages}.ts` and their tests, `tests/e2e/support/articles-stub.ts`,
`tests/e2e/specs/articles.spec.ts`, plus the `storeChapter(…)` seeding calls in about 17 db test files (one argument
each)

**Estimated scope:** M, plus mechanical call-site changes

---

## Task 4: Books per user (`LIMIT_BOOKS`)

**Description:** `startImport` and `startAudiobook` take `(pool, userId, book, now, limits, …)` with `limits` required.
`maxBooks` goes. Both handlers pass `getConfig().limits`, and every seeding call passes `DEFAULT_LIMITS`.
`getMyBooksPage` adds `limits`, and the books route hands it to `BookImporter`, which hands it to `pickRefusal` and the
audiobook importer. `BOOK_QUOTA_TEXT` becomes `bookQuotaText(max)`: "Your library holds up to 25 books. Delete one to
import another." `import-client` keeps `max` on a `quota` refusal, and `audiobook-problems`' `books` case uses the
refusal's `max`. Delete `MAX_BOOKS`. The `user-books.db.test.ts` quota tests, including the starter-copy case, run at a
small `books` limit.

**Acceptance criteria:**
- [ ] With `books: 2`: two imports succeed, and the third gets `{ ok: false, reason: 'quota', max: 2 }`. The same for
      an audiobook start. A reader over a lowered limit (3 books, limit 2) can delete one, and the next import is still
      refused.
- [ ] `instance-limits.db.test.ts`: with the mocked `books`, the book and audiobook start handlers answer
      `409 { error: 'quota', scope: 'books', max }` with that value
- [ ] `pick.test.ts` and `import-problems.test.ts` pass a limit in, and the message names it

**Verification:**
- [ ] `pnpm check`, `pnpm test:db`
- [ ] `import.spec.ts` and `audiobook-import.spec.ts` on desktop

**Dependencies:** Task 3

**Files likely touched:** `src/server/user-books.ts`, `src/server/audiobooks/{store,actions}.ts`,
`src/server/book-actions.ts`, `src/server/account-functions.ts`, `src/shared/import/limits.ts`,
`src/routes/account/books/index.tsx`, `src/client/features/import/BookImporter.tsx`,
`src/client/features/import/{pick,import-problems,import-client}.ts`,
`src/client/features/audiobook-import/AudiobookImporter.tsx`,
`src/client/features/audiobook-import/{audiobook-problems,audiobook-client}.ts`, their tests,
plus the `startImport(…)` seeding calls in about 17 db test files

**Estimated scope:** M, plus mechanical call-site changes

---

## Task 5: Saved articles (`LIMIT_ARTICLES`)

**Description:** `ArticleStart` loses `max`, and `startImport`'s article branch checks `limits.articles`.
`handleNewBook` stops building `max`. `ArticlesState`'s `ready` member gains `limits: InstanceLimits`, `articlesState`
sends `getConfig().limits`, and `max` stays, equal to `limits.articles`. `articleProblemText`'s `quota` case needs
`max` (from the refusal) and loses its `MAX_ARTICLES` fallback. Delete `MAX_ARTICLES`. The 500-article db test runs at
a small `articles` limit.

**Acceptance criteria:**
- [ ] With `articles: 3`: three saves succeed and the fourth gets `quota` with `max: 3`. Books are counted apart.
- [ ] `instance-limits.db.test.ts`: the mocked `articles` reaches `409 { error: 'quota', scope: 'articles', max }`,
      and `articlesState` sends `limits` with `max === limits.articles`
- [ ] `articles/actions.ts` keeps its 100% floor

**Verification:**
- [ ] `pnpm check`, `pnpm test:db`
- [ ] `articles.spec.ts` on desktop

**Dependencies:** Task 4

**Files likely touched:** `src/shared/articles/contract.ts`, `src/server/user-books.ts`, `src/server/book-actions.ts`,
`src/server/articles/actions.ts`, `src/server/articles/articles.db.test.ts`,
`src/client/features/articles/{article-messages,articles-client}.ts`, `SaveArticleForm.tsx`, `ArticlesPage.tsx`, their
tests

**Estimated scope:** S

---

## Checkpoint: Text caps (after Tasks 3–5, self-check)
- [ ] `git grep -nE '\bMAX_BOOKS\b|\bMAX_ARTICLES\b' -- src scripts tests` prints nothing
- [ ] `pnpm check` and `pnpm test:db` pass, with coverage at or above the baseline
- [ ] `articles.spec.ts`, `import.spec.ts` and `audiobook-import.spec.ts` pass on desktop
- [ ] If not, fix and re-run before going on

---

## Task 6: Picture storage per user (`LIMIT_USER_PICTURES`)

**Description:** `startImport` checks `limits.userPictureBytes`, and refuses for room only when the upload has
pictures (plan Decision 3). `storeImage` takes a required `limits`, and its handler passes `getConfig().limits`.
`BOOK_ROOM(userBytesLeft)` loses its default. `BookImporter` and `article-save` compute the room from
`limits.userPictureBytes` in loader data (`getMyBooksPage`, and `articlesState` from Task 5). `BookImporter`'s
`megabytes` goes, and its left-out reason uses `formatBytes`. A `quota-user` refusal keeps its `max`. Delete
`MAX_USER_IMAGE_BYTES`. `book-images.db.test.ts`'s "within 250 MB" test runs at a small limit and is renamed for what
it checks.

**Acceptance criteria:**
- [ ] With `userPictureBytes` small: pictures up to the limit are stored and the next gets `{ quota: 'user', max }`,
      in `storeImage` and in `startImport`'s `room` check
- [ ] A reader over a lowered picture limit can import a book with no pictures, and is refused a book with one
      (`user-books.db.test.ts`), and can still delete a book
- [ ] `instance-limits.db.test.ts`: the mocked value reaches both the start and the picture upload refusals, and
      `article-save.test.ts` and `draft.test.ts` pass the room in

**Verification:**
- [ ] `pnpm check`, `pnpm test:db`
- [ ] `import.spec.ts` and `articles.spec.ts` on desktop

**Dependencies:** Task 5

**Files likely touched:** `src/server/user-books.ts`, `src/server/book-images/{store,actions}.ts`,
`src/server/book-images/book-images.db.test.ts`, `src/shared/import/{limits,draft}.ts`,
`src/client/features/import/BookImporter.tsx`, `src/client/features/articles/{article-save.ts,SaveArticleForm.tsx}`,
their tests, plus the `storeImage(…)` calls in `downloads.db.test.ts`

**Estimated scope:** M

---

## Task 7: One audiobook's size (`LIMIT_AUDIOBOOK_SIZE`)

**Description:** `parseAudiobookStart(value, maxBytes, now = new Date())` checks each file and the total against
`maxBytes`. The handler wraps it as `parse: (value) => parseAudiobookStart(value, getConfig().limits.audiobookBytes)`.
`ReadOptions` in `read-audiobook.ts` gains `limits`, and the `large` problem carries its `max`.
`problemText`'s `large` case reads "This audiobook is larger than 1 GB." from that `max`. Delete `MAX_AUDIOBOOK_BYTES`.

**Acceptance criteria:**
- [ ] `input.test.ts`: with a small `maxBytes`, a start at the cap parses and one byte over returns `null`, for one
      M4B and for MP3s in total
- [ ] `instance-limits.db.test.ts`: with the mocked value, a start one byte over is refused (`400 invalid`) and one at
      the cap gets past the parser
- [ ] `read-audiobook.test.ts` and `audiobook-problems.test.ts` pass limits in, and the message names the value, not
      "2 GB"

**Verification:**
- [ ] `pnpm check`, `pnpm test:db`
- [ ] `audiobook-import.spec.ts` on desktop

**Dependencies:** Task 4

**Files likely touched:** `src/shared/audiobooks/{input,limits}.ts`, `src/shared/audiobooks/input.test.ts`,
`src/server/audiobooks/actions.ts`, `src/client/features/audiobook-import/{read-audiobook,audiobook-problems}.ts`,
`AudiobookImporter.tsx`, their tests

**Estimated scope:** S

---

## Task 8: Audio per user (`LIMIT_USER_AUDIO`)

**Description:** `startAudiobook` checks `limits.userAudioBytes` and answers its `max`. `read-audiobook`'s room check
uses `limits.userAudioBytes`. The `room` problem carries `max`, from the response on a server refusal
(`audiobook-client`, `quota` scope `audio`) or from the limits on the browser's own check. `problemText`'s `room` case
reads "Your audiobooks would go over 1 GB. Delete one to make room." Delete `MAX_USER_AUDIO_BYTES`.
`audiobooks.db.test.ts`'s "the 8 GB of audio" test runs at a small limit and is renamed for what it checks.

**Acceptance criteria:**
- [ ] With `userAudioBytes` small: a start that brings the total to the limit succeeds, and the next gets
      `{ quota: 'audio', max }`. A reader over a lowered limit can delete an audiobook, and the next start is refused.
- [ ] `instance-limits.db.test.ts`: the mocked value reaches `409 { error: 'quota', scope: 'audio', max }`
- [ ] `read-audiobook.test.ts` and `audiobook-problems.test.ts` name the configured value, not "8 GB"

**Verification:**
- [ ] `pnpm check`, `pnpm test:db`
- [ ] `audiobook-import.spec.ts` on desktop

**Dependencies:** Tasks 4 and 7

**Files likely touched:** `src/server/audiobooks/store.ts`, `src/server/audiobooks/audiobooks.db.test.ts`,
`src/shared/audiobooks/limits.ts`,
`src/client/features/audiobook-import/{read-audiobook,audiobook-problems,audiobook-client}.ts`, their tests

**Estimated scope:** S

---

## Checkpoint: Every cap configurable (after Tasks 6–8, self-check)
- [ ] The leftover check prints nothing
- [ ] `pnpm check` and `pnpm test:db` pass, with coverage at or above the baseline
- [ ] `import.spec.ts`, `articles.spec.ts` and `audiobook-import.spec.ts` pass on desktop
- [ ] If not, fix and re-run before going on

---

## Task 9: Storage section, with the hosted values in e2e

**Description:** `getAccountPage` adds
`storage: { bookCount, articleCount, audioBytes, pictureBytes, audiobooks, limits }` (plan Decision 2), from
`countedBooks`, `countedArticles`, `audioBytesUsed`, `imageBytesUsed`, `audiobooksOn()` and `getConfig().limits`.
`src/client/features/account/storage-text.ts` holds the wording ("3 of 25 books", "412 MB of 1 GB of audiobooks", and
"over the limit, delete some to add more" when usage is past the limit) and the meter values, which never go past
full. `StorageSection.tsx` shows four lines with a `<meter>` each where `PlanSection` was, between Profile and Email,
and hides the audio line when `audiobooks` is false. `test-server.ts` sets `LIMIT_USER_AUDIO=1GB`,
`LIMIT_AUDIOBOOK_SIZE=1GB` and `LIMIT_USER_PICTURES=100MB`. The account page object gains the section's locators.

**Acceptance criteria:**
- [ ] `account.spec.ts`: the Storage section reads "of 1 GB" and "of 100 MB", and after a book is imported it says
      "1 of 25 books". The page passes the axe check the spec already runs.
- [ ] `storage-text.test.ts`: each line's wording, the audio line hidden when audiobooks are off, and the over-limit
      line with a full meter
- [ ] A db test shows `getAccountPage`'s `storage` counts and the mocked limits

**Verification:**
- [ ] `pnpm check`, `pnpm test:db`
- [ ] `account.spec.ts` on desktop, phone and tablet

**Dependencies:** Tasks 4–8

**Files likely touched:** `src/server/account-functions.ts`, `src/client/features/account/storage-text.ts` (new),
`src/client/features/account/storage-text.test.ts` (new), `src/client/features/account/StorageSection.tsx` (new),
`src/routes/account/index.tsx`, `tests/e2e/support/test-server.ts`, `tests/e2e/pages/account-page.ts`,
`tests/e2e/specs/account.spec.ts`

**Estimated scope:** M

---

## Task 10: Proof matrix, startup check, full runs and commit

**Description:** Build the proof matrix: for each of the six caps, the `config.test.ts` case, the store db test at the
limit, the `instance-limits.db.test.ts` handler case, and the browser test that names the value, each with a file and
test name. Run the leftover check (it prints nothing). Run `pnpm build && LIMIT_USER_AUDIO=1 pnpm start` and check it
exits 1 naming `LIMIT_USER_AUDIO` (plan Decision 4). Run `pnpm check`, `pnpm test:db` and `pnpm e2e:local`, rerunning
a known flaky spec alone before debugging it, and compare coverage with the baseline. Rename any unclear names in
touched functions (plan Decision 6). Set the map's Progress row to "built, awaiting sign-off", add build notes to this
file for anything that left the plan, and commit locally on `main`. **Don't push.**

**Acceptance criteria:**
- [ ] The proof matrix is complete and recorded in the final message
- [ ] The leftover check prints nothing, the startup check exits 1 naming the variable, and the three full runs pass
      with no coverage floor lowered
- [ ] One local commit on `main` (and one rename commit after it only if something was renamed), and this file ends
      with an empty sign-off line

**Verification:**
- [ ] The three full runs, and `git log origin/main..main --oneline`
- [ ] Grep the staged diff for secrets and personal addresses: nothing

**Dependencies:** Task 9

**Files likely touched:** `spec/capability-map.md`, this file

**Estimated scope:** S

---

## Checkpoint: Complete
- [ ] Every success criterion in the spec the build can check is met, and the rest are in "Needs owner action"
- [ ] The final message lists the "Needs owner action" items first, then the proof matrix and the summary

---

## Needs owner action

**After the build:**
- [ ] Review the commit, push `main`, let CI deploy to dev, then deploy to production with `deploy-prod.yml`.
- [ ] Add the hosted values to the server's env files, for dev and for production (spec Cut-over step 2):
      ```
      LIMIT_USER_AUDIO=1GB
      LIMIT_AUDIOBOOK_SIZE=1GB
      LIMIT_USER_PICTURES=100MB
      ```
      Leave the other three unset, because their defaults are the hosted values. Restart both.
- [ ] On dev and production, check that the account page's Storage section says "of 1 GB" and "of 100 MB".
- [ ] If your own account on production is over 1 GB of audio, nothing is deleted, but your next audiobook upload is
      refused. Raise `LIMIT_USER_AUDIO` if you want room.
- [ ] Before `go-public` sets `SIGNUP=open`, the hosted values must be live on production.
- [ ] Sign off. Claude fills in the line below, marks the Progress row done, and commits and pushes.

Signed off: ____ (date)
