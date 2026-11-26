# Tasks: billing-removal

Plan: [tasks/billing-removal-plan.md](billing-removal-plan.md) · Spec: [spec/SPEC-billing-removal.md](../spec/SPEC-billing-removal.md)

Boundaries that apply to every task: remove a gate's branch, not its result (no `canUse` that returns true, no
`plan: 'pro'` constant, no flag). Keep each feature's other checks: signed in, own key saved, rate limits, quotas and
disk space. Don't change any limit's value, rewrite Terms or Privacy beyond the billing parts, delete `audit_events`
rows, touch `user_books.starter` or `users.starter_book_at`, or lower a coverage floor. Never edit an applied
migration, and never touch the Paddle account, the server's env or its credentials. Follow
[CODE_STANDARDS.md](../CODE_STANDARDS.md): descriptive names, `/** */` comments, no `any`. Don't edit
`src/routeTree.gen.ts` by hand; the build regenerates it.

**How this is built:** in two builds. Release 1 runs in one go from Task 0 to Task 14, and release 2 runs in one go
from Task R0 to Task R2 in a later session. The owner reviews each build once, at its end. The checkpoints are
self-checks: if one fails, fix it and re-run it before moving on, don't stop to ask. Anything that needs the owner goes
in the **"Needs owner action"** list at the bottom of this file, and the build carries on. Nothing in that list is done
on the owner's behalf.

**Leftover check**, used by Tasks 14 and R2. The spec's command with two more exclusions:

```
git grep -niE 'paddle|pro_granted|subscriptions|refund|PRO_|FREE_LIMITS|requirePro|canUse\(' -- \
  ':!spec' ':!tasks' ':!.gitleaks.toml' ':!db/migrations/001[89]_*'
```

Expected hits after release 1, and nothing else: the 404 test's three URLs, the leftover `PADDLE_*` case in
`config.test.ts`, and `subscriptions` and `paddle_events` in `migrations.db.test.ts`'s table list. After release 2: the
drop migration and its case in `migrations.db.test.ts`. The release-1 build found one more, kept on purpose: the
`'subscriptions set null'` line in `admin.db.test.ts` (see "Release 1 build notes"). Release 2 removes it.

**Per-task verification:** `pnpm check` (lint, types, unit tests with coverage) and `pnpm test:db`, plus the e2e specs
the task names, run on desktop with `pnpm e2e:local --grep` or by file. The full e2e run is in Task 14.

---

# Release 1

## Task 0: Preflight

**Description:** Before any work, confirm the build can run end to end. `git status` is clean on `main`. Postgres
(`agentic-pg`) answers, `pnpm check` and `pnpm test:db` pass on the untouched tree, and one e2e spec
(`home.spec.ts` on desktop) runs. Record the four coverage totals from each of the two runs in `$SCRATCH/baseline.txt`,
so later checkpoints can compare. If any of these fails, stop now and say what's wrong. This is the only stop, and it
comes before any work is done.

**Acceptance criteria:**
- [x] `git status` is clean on `main`
- [x] `pnpm check` and `pnpm test:db` pass, and their coverage totals are recorded
- [x] `home.spec.ts` passes on desktop

**Dependencies:** None

**Estimated scope:** XS

---

## Task 1: Ask and Ask prompts, ungated

**Description:** Remove `requirePro(session, 'ask')` from `ask/ask.ts` and both sites in `ask-prompts/actions.ts`,
and `canUse` from `ask/setup.ts`, so the `pro` flag it computes goes. The Ask prompts page state loses `plan`
(`{ state: 'ready', prompts }`). On the client, `AskPanel`, `ask-problems`, `PromptsPage`, `prompt-messages` and
`ask-prompts-client` lose their `pro` cases and the `ProNotice` they show. The key check stays.

**Acceptance criteria:**
- [x] A plain member with no grant and a saved key can ask, and list, add and use prompts (one db test each, changed
      from an existing Pro setup)
- [x] The prompts page state has no `plan`, and no client code reads one
- [x] The Free-refusal tests for Ask and prompts are deleted, and the no-key tests stay

**Verification:**
- [x] `pnpm check`, `pnpm test:db`
- [x] `ask.spec.ts` and `ask-prompts.spec.ts` on desktop

**Dependencies:** Task 0

**Files likely touched:** `src/server/ask/{ask,setup}.ts`, `src/server/ask-prompts/{actions,store,input}.ts`,
`src/shared/ask-prompts/prompts.ts`, `src/client/features/ask/*`, `src/client/features/ask-prompts/*`, their tests

**Estimated scope:** M

---

## Task 2: Translate and Export, ungated

**Description:** Remove `requirePro(session, 'translate')` from `lookup/actions.ts`, and both `requireProText` calls
from `highlights/export.ts`, so export no longer answers the `proNotice` heading as text. On the client, `LookupCard`,
`lookup-messages`, `lookup-client` and `routes/account/highlights/index.tsx` lose their Pro branches.

**Acceptance criteria:**
- [x] A plain member with no grant can translate with their own key, and export their notes as Markdown (a db test
      each)
- [x] The highlights page shows the export link to every signed-in reader

**Verification:**
- [x] `pnpm check`, `pnpm test:db`
- [x] `lookup.spec.ts` and `highlights.spec.ts` on desktop

**Dependencies:** Task 0

**Files likely touched:** `src/server/lookup/actions.ts`, `src/server/highlights/export.ts`,
`src/client/features/lookup/*`, `src/routes/account/highlights/index.tsx`, their tests

**Estimated scope:** S

---

## Task 3: Audiobooks and ElevenLabs voices, ungated

**Description:** Remove `requirePro` from `audiobooks/actions.ts` and `speech/actions.ts`, and the `canUse` check that
answers `{ state: 'pro' }` for the voice list. The `'pro'` state leaves `shared/read-aloud/cloud.ts`, and the client's
`VoiceMenu`, `read-aloud/controller` and `messages`, `speech-client`, `audiobook-problems`, `audiobook-client` and
`upload` lose their `pro` cases. In `import/pick.ts` and `BookImporter`, the "audiobooks are Pro" refusal goes. Book
counts there move in Task 6. Disk space and the audio caps stay.

**Acceptance criteria:**
- [x] A plain member with no grant can start an audiobook upload and list ElevenLabs voices with their own key (a db
      test each)
- [x] No server code answers `{ state: 'pro' }`, and the type has no `'pro'` member
- [x] `speech/actions.ts` keeps its per-file coverage floor

**Verification:**
- [x] `pnpm check`, `pnpm test:db`
- [x] `audiobook-import.spec.ts` and `read-aloud-elevenlabs.spec.ts` on desktop

**Dependencies:** Task 0

**Files likely touched:** `src/server/audiobooks/actions.ts`, `src/server/speech/actions.ts`,
`src/shared/read-aloud/cloud.ts`, `src/client/features/read-aloud/*`, `src/client/features/audiobook-import/*`,
`src/client/features/import/{pick.ts,BookImporter.tsx}`, their tests

**Estimated scope:** M

---

## Task 4: Flashcards and Run code, ungated

**Description:** Remove `requirePro` from both sites in `flashcards/actions.ts`, and both `canUse` branches in
`flashcards/page.ts`, so the counts-only page goes. On the client, `FlashcardsPage`, `flashcard-problems`,
`flashcards-client` and `routes/account/flashcards/index.tsx` lose their Pro branches. Run code is gated only in the
browser: `run-code/run-access.ts` stops reading `viewer.plan`, and `RunDialog` and the `run-dialog` page object lose
the Pro state. The signed-out copy becomes "Sign in to run code." without "Running code is part of Pro."

**Acceptance criteria:**
- [x] A plain member with no grant can open their flashcards page with cards and review one (a db test)
- [x] A plain member runs a code example (`run-code.spec.ts`, signed in as a member)
- [x] `run-access.ts` decides only signed in or signed out, with no plan input

**Verification:**
- [x] `pnpm check`, `pnpm test:db`
- [x] `study.spec.ts` and `run-code.spec.ts` on desktop

**Dependencies:** Task 0

**Files likely touched:** `src/server/flashcards/{actions,page}.ts`, `src/client/features/flashcards/*`,
`src/routes/account/flashcards/index.tsx`, `src/client/features/run-code/*`, `tests/e2e/pages/run-dialog.ts`,
`tests/e2e/specs/run-code.spec.ts`, their tests

**Estimated scope:** M

---

## Task 5: Any account can save any API key

**Description:** In `account-actions.ts`, remove the `canUse` check that redirects to `/account/api-keys?error=pro`,
and the `feature` field on the key rules if nothing else reads it. `routes/account/api-keys.tsx` shows every form to
every account, and `account-messages` loses the `pro` case.

**Acceptance criteria:**
- [x] A plain member saves an Anthropic, an OpenAI and an ElevenLabs key (the existing refusal test in
      `accounts.db.test.ts` is turned into this)
- [x] `account.spec.ts`'s "on Free the section is locked behind Pro" test is deleted, and a member save test stays

**Verification:**
- [x] `pnpm check`, `pnpm test:db`
- [x] `account.spec.ts` on desktop

**Dependencies:** Task 0

**Files likely touched:** `src/server/account-actions.ts`, `src/routes/account/api-keys.tsx`,
`src/client/features/account/account-messages.ts`, `src/server/accounts.db.test.ts`,
`tests/e2e/specs/account.spec.ts`

**Estimated scope:** S

---

## Checkpoint: Features (after Tasks 1–5, self-check)
- [x] `git grep -nE 'requirePro|canUse\(' -- src` finds only `src/server/plans/` and `src/shared/plans/`
- [x] `pnpm check` and `pnpm test:db` pass, with coverage totals at or above the floors
- [x] If not, fix and re-run before going on

---

## Task 6: Book and audiobook quotas use the Pro limit

**Description:** `book-actions.ts` and `audiobooks/actions.ts` use `MAX_BOOKS` directly, as in the spec's example,
and their quota answers lose `plan`: `409 { error: 'quota', scope, max }`. On the client, `post.ts`, `import-client`,
`import-problems`, `audiobook-problems`, `audiobook-client` and `pick.ts` lose the `quota-free` case and keep one quota
message. The starter-copy test in `user-books.db.test.ts` is rewritten against `MAX_BOOKS` (decided 2026-11-25), and
the "moved from Pro to Free" test is deleted.

**Acceptance criteria:**
- [x] A plain member imports 25 books, and the 26th gets `409 { error: 'quota', scope: 'books', max: 25 }` with no
      `plan`
- [x] The starter-copy case still shows a former starter copy counts, at the `MAX_BOOKS` limit
- [x] No client code reads `plan` from a quota answer

**Verification:**
- [x] `pnpm check`, `pnpm test:db`
- [x] `import.spec.ts` on desktop

**Dependencies:** Task 3

**Files likely touched:** `src/server/book-actions.ts`, `src/server/audiobooks/actions.ts`,
`src/client/lib/post.ts`, `src/client/features/import/*`, `src/client/features/audiobook-import/*`, their tests,
`src/server/user-books.db.test.ts`

**Estimated scope:** M

---

## Task 7: Highlight and article quotas use the Pro limits

**Description:** `highlights/actions.ts` uses `MAX_HIGHLIGHTS_PER_BOOK` and `MAX_HIGHLIGHTS_PER_USER`, and
`articles/actions.ts` uses `MAX_ARTICLES`. `PRO_ARTICLES` is renamed `MAX_ARTICLES` with TypeScript's rename, and
`FREE_ARTICLES` is deleted. Quota answers and the article save failure lose `plan`. On the client, `highlight-list`,
`bookmarks-client`, `articles-client`, `article-messages`, `ArticlesPage` and `SaveArticleForm` lose the `quota-free`
case.

**Acceptance criteria:**
- [x] A plain member saves 500 articles and the 501st gets `409 { error: 'quota', scope: 'articles', max: 500 }`
- [x] A plain member reaches `MAX_HIGHLIGHTS_PER_BOOK`, and the next highlight gets the `book` quota answer with no
      `plan`. The same for `MAX_HIGHLIGHTS_PER_USER`
- [x] `articles/actions.ts` keeps its 100% coverage floor

**Verification:**
- [x] `pnpm check`, `pnpm test:db`
- [x] `articles.spec.ts` and `highlights.spec.ts` on desktop

**Dependencies:** Task 2

**Files likely touched:** `src/server/highlights/actions.ts`, `src/server/articles/actions.ts`,
`src/shared/articles/contract.ts`, `src/client/features/highlights/*`, `src/client/features/articles/*`,
`src/client/features/bookmarks/bookmarks-client.ts`, their tests

**Estimated scope:** M

---

## Task 8: Account deletion and sign-in stop calling Paddle

**Description:** `deleteAccount` in `admin/store.ts` stops calling `cancelBilling` and `detachUser`. `DeleteResult`
loses `billing_failed`, and the `skipBilling` and `paddle` options go. `account-actions.ts`, `admin/actions.ts` and
`routes/account/index.tsx` lose their `billing_failed` and `delete-billing` branches, and `account-messages` its
`delete-billing` copy. `scripts/db/users.ts delete` loses `--skip-billing`. `sign-in.ts` and `passkeys/sign-in.ts` stop
calling `sweepPaddleEvents`, and `login.db.test.ts` loses its sweep case.

**Acceptance criteria:**
- [x] A db test deletes an account with no outbound HTTP call (the fetch double sees no call) and `DeleteResult` has
      no `billing_failed`
- [x] Nothing outside `src/server/billing/` imports from it
- [x] `sign-in.ts` keeps its 100% floor, and `passkeys/sign-in.ts` its per-file floor

**Verification:**
- [x] `pnpm check`, `pnpm test:db`
- [x] `account.spec.ts` and `users.spec.ts` on desktop

**Dependencies:** Task 0

**Files likely touched:** `src/server/admin/{store,actions}.ts`, `src/server/account-actions.ts`,
`src/routes/account/index.tsx`, `src/client/features/account/account-messages.ts`, `scripts/db/users.ts`,
`src/server/sign-in.ts`, `src/server/passkeys/sign-in.ts`, `src/server/login.db.test.ts`,
`src/server/admin/admin.db.test.ts`, `src/server/accounts.db.test.ts`

**Estimated scope:** M

---

## Task 9: Delete the Paddle modules, routes, Pro page and billing tests

**Description:** Delete `src/server/billing/`, `src/shared/billing/`, `src/server/testing/paddle.ts`,
`src/routes/billing/`, `src/routes/account/plan/`, `src/client/features/billing/` and `scripts/billing/`. Delete
`billing.spec.ts`, `tests/e2e/pages/pro-page.ts`, `tests/e2e/support/paddle-stub.ts` and `fake-paddle.ts`, and their
wiring in `test-server.ts`. Remove `@paddle/paddle-js` and update `pnpm-lock.yaml`. In `playwright.config.ts`, remove
the `PADDLE_*` env and the `billing` entry in the phone project's spec list. Remove `use-checkout.ts` from
`tests/tested-modules.test.ts`, and `'insert into subscriptions'`, `'portal-sessions'` and `'paddle-signature'` from
`bundle.spec.ts`'s list. This is a large delete but few edits.

**Acceptance criteria:**
- [x] The listed paths are gone, and the build regenerates `src/routeTree.gen.ts` without `/billing/paddle` and
      `/account/plan`
- [x] `@paddle/paddle-js` isn't in `package.json` or `pnpm-lock.yaml`
- [x] `git grep -n "billing/" -- src scripts tests` finds no import

**Verification:**
- [x] `pnpm install`, `pnpm build`, `pnpm check`, `pnpm test:db`
- [x] `bundle.spec.ts` on desktop

**Dependencies:** Task 8

**Files likely touched:** the deleted paths, `package.json`, `pnpm-lock.yaml`, `playwright.config.ts`,
`tests/e2e/support/test-server.ts`, `tests/tested-modules.test.ts`, `tests/e2e/specs/bundle.spec.ts`

**Estimated scope:** M (mostly deletes)

---

## Task 10: Billing config, redaction, audit types and export key go

**Description:** In `config.ts`, remove `BillingConfig`, `PaddleEnv`, `parseBilling`, the `billing` field and the
`PADDLE_API_BASES` and `TOKEN_PREFIX` tables. `config.test.ts` loses the billing cases and gains one: a config with
leftover `PADDLE_*` env values and `paddle_*` credentials parses, and has no billing field. In `redact.ts`, the `pdl_`
pattern goes. In `audit.ts`, `plan.granted`, `plan.revoked`, `billing.checkout` and `billing.subscription` leave the
event type; existing rows stay. The account-data export loses its `subscriptions` key and query, and `EXPORT_VERSION`
stays 1. `user-rows.ts` stops inserting a `subscriptions` row, `KEPT_WITHOUT_USER` goes, and `subscriptions` and
`paddle_events` leave the test truncate lists.

**Acceptance criteria:**
- [x] The server's config parses with leftover `PADDLE_*` values set (the new `config.test.ts` case)
- [x] `redact.ts` keeps its 100% floor, and the export test shows no `subscriptions` key
- [x] Nothing outside the old migrations and `migrations.db.test.ts` names `subscriptions` or `paddle_events`

**Verification:**
- [x] `pnpm check`, `pnpm test:db`

**Dependencies:** Task 9

**Files likely touched:** `src/server/config.ts`, `src/server/config.test.ts`, `src/server/redact.ts`,
`src/server/redact.test.ts`, `src/server/audit.ts`, `src/server/account-data/{export,store}.ts`,
`src/server/account-data/export.test.ts`, `src/server/testing/user-rows.ts`, truncate lists in db tests and
`test-server.ts`

**Estimated scope:** M

---

## Checkpoint: No Paddle (after Tasks 6–10, self-check)
- [x] `git grep -niE 'paddle' -- src scripts tests package.json playwright.config.ts` finds only the leftover
      config case
- [x] `pnpm check` and `pnpm test:db` pass, with coverage at or above the floors (compare with `$SCRATCH/baseline.txt`)
- [x] If not, fix and re-run before going on

---

## Task 11: Admin grants go

**Description:** The admin Users page (`UsersList`, `admin-client`, `users-store`), `admin/view.ts` and
`shared/admin/users.ts` lose the plan column, the paid label and the Give Pro and Take Pro buttons, and the admin
action that sets `pro_granted_at`. `scripts/db/users.ts` loses `grant-pro` and `revoke-pro`, and `list` has no plan
column. `src/server/users.ts` stops selecting `pro_given`.

**Acceptance criteria:**
- [x] The Users page shows no plan, paid label or Pro buttons (`users.spec.ts`)
- [x] `node scripts/db/users.ts` usage text has no `grant-pro`, `revoke-pro` or `--skip-billing`
- [x] Nothing reads or writes `pro_granted_at` or `pro_granted_by` outside `src/server/plans/` and
      `src/server/sessions.ts`

**Verification:**
- [x] `pnpm check`, `pnpm test:db`
- [x] `users.spec.ts` on desktop

**Dependencies:** Task 10

**Files likely touched:** `src/client/features/admin/*`, `src/server/admin/{view,actions}.ts`,
`src/shared/admin/users.ts`, `src/server/users.ts`, `scripts/db/users.ts`, their tests

**Estimated scope:** M

---

## Task 12: Pages and copy without plans or prices

**Description:** Home: the Hero has no price and no "Pro is coming soon" (it may say Folio is free, and promises
nothing else), `PricingSection` is deleted with nothing in its place, and the FAQ loses `PAYING_QUESTIONS` and
`NO_TRIAL`. `SiteFooter` and `HomeFooter` lose the Refunds link. `src/routes/refunds.tsx` and `REFUNDS_UPDATED` go,
and `/refunds` leaves `scripts/smoke-dev.ts`, `private-pages.test.ts`, `site.test.ts`, `test-ids.spec.ts` and
`signup.spec.ts`. The account page loses `PlanSection`, and deletion copy doesn't mention a subscription. Terms lose
"Free and Pro", "Paying for Pro", Paddle as reseller and the refunds link; Privacy loses subscription data and Paddle as
a processor. `TERMS_UPDATED` and `PRIVACY_UPDATED` move to the build date. Nothing else in Terms or Privacy changes.
`home.spec.ts` checks there is no pricing section and no price, and `account.spec.ts` that there is no plan section.

**Acceptance criteria:**
- [x] The home, account, Terms and Privacy pages show no price, plan, Pro, Paddle or refund
- [x] `scripts/smoke-dev.ts` no longer visits `/refunds`
- [x] The Terms and Privacy diffs only remove billing text and change the dates

**Verification:**
- [x] `pnpm check`, `pnpm test:db`
- [x] `home.spec.ts`, `account.spec.ts` and `signup.spec.ts` on desktop

**Dependencies:** Task 10

**Files likely touched:** `src/client/features/home/{Hero,PricingSection,Faq,HomeFooter}.tsx`,
`src/client/components/SiteFooter.tsx`, `src/routes/{index,refunds,terms,privacy}.tsx`, `src/shared/lib/site.ts`,
`src/client/features/account/PlanSection.tsx`, `src/routes/account/index.tsx`, `scripts/smoke-dev.ts`, their tests

**Estimated scope:** M

---

## Task 13: Delete the plan concept

**Description:** Sessions, access-token sessions and `Viewer` lose `plan`, and the session query stops reading
`pro_granted_at` and `subscriptions`. `/api/me` answers `{ username, role, via }`. Delete `src/server/plans/`,
`src/shared/plans/` and `src/client/features/plans/ProNotice.tsx`. The test helpers (`testing/users.ts`,
`tests/e2e/support/accounts.ts`, `test-server.ts`) lose their `plan` parameter and stop setting `pro_granted_at`, and
every test that passed `plan` stops. `plans.spec.ts` and its entry in the phone project go. `'pro_granted_at'` leaves
`bundle.spec.ts`'s list. The compiler finds every remaining reader; fix each by removing the branch.

**Acceptance criteria:**
- [x] `src/shared/plans/`, `src/server/plans/` and `ProNotice.tsx` are gone, and `pnpm typecheck` passes
- [x] `/api/me` answers `{ username, role, via }` (a db test)
- [x] `sessions.ts`, `access-tokens/store.ts` and `auth.ts` keep their per-file floors

**Verification:**
- [x] `pnpm check`, `pnpm test:db`
- [x] `access-tokens.spec.ts`, `reading-stats.spec.ts` and `bundle.spec.ts` on desktop

**Dependencies:** Tasks 1–12

**Files likely touched:** `src/server/{sessions,auth}.ts`, `src/server/access-tokens/store.ts`,
`src/server/account-functions.ts`, the deleted paths, the test helpers, and the tests that passed `plan` (about 30
files, each a one-line change)

**Estimated scope:** L (mechanical, driven by type errors)

---

## Task 14: Proof matrix, leftover check, full runs and commit

**Description:** Check that each of the seven features (Ask, Translate, Export, Audiobooks, ElevenLabs voices,
Flashcards, Run code) has a db or e2e test that signs in as a plain **member**, not an admin, and uses it. Check each
quota (books 25, articles 500, highlights per book, highlights per user) has a test at the former Pro value with no
`plan` in the answer. Add a short e2e check that `/account/plan`, `/refunds` and `/billing/paddle` answer 404. Run the
leftover check and confirm only the expected hits remain. Grep `src/` for `\bPro\b`, `'pro'` and `plan` and confirm
each hit is unrelated (for example the read-aloud `Plan` of utterances). Run `pnpm check`, `pnpm test:db` and
`pnpm e2e:local`, rerunning a known flaky spec on its own before debugging it. Compare coverage with the baseline.
Rename any unclear names in touched functions. Then mark the Progress row "release 1 built, awaiting owner deploy" and
commit locally (see Decisions in the plan). **Don't push.**

**Acceptance criteria:**
- [x] The proof matrix (seven features and four quotas) is complete, each with a file and test name, recorded in the
      final message
- [x] The leftover check shows only the expected hits, and `pnpm check`, `pnpm test:db` and `pnpm e2e:local` pass,
      with no coverage floor lowered
- [x] One removal commit on `main`, and one rename commit after it if any names were renamed, both local

**Verification:**
- [x] The three full runs, and `git log origin/main..main --oneline`
- [x] Grep the staged diff for secrets and personal addresses: nothing

**Dependencies:** Task 13

**Files likely touched:** a new 404 e2e check, `spec/capability-map.md`, this file

**Estimated scope:** S

---

## Checkpoint: Release 1 complete
- [x] Every release-1 success criterion the build can check is met, and the rest are in "Needs owner action"
- [x] The final message lists the "Needs owner action" items first, then the proof matrix and the summary

---

# Release 2 (a later session)

## Task R0: Preflight for the drop

**Description:** Start only when the owner says release 1 is live on production and the cut-over check (spec step 2)
passed on dev and production. Confirm the release-1 commit is on `origin/main`, `git status` is clean, and
`git grep -nE 'subscriptions|paddle_events|pro_granted' -- src scripts tests` finds only `migrations.db.test.ts`. Work
out the migration number from the newest file in `db/migrations/`. If the owner hasn't confirmed, or the grep finds a
reader, stop now and say so.

**Acceptance criteria:**
- [ ] The owner has confirmed release 1 is live on production
- [ ] Only `migrations.db.test.ts` names the four objects outside the old migrations
- [ ] The new migration's number is known (`0029` if nothing else landed)

**Dependencies:** Task 14, and the owner's deploy

**Estimated scope:** XS

---

## Task R1: The drop migration and its test

**Description:** Add `db/migrations/00NN_drop_billing.sql` with the spec's SQL and comment. In
`migrations.db.test.ts`, remove the two tables from the expected table list and add the release-2 case: on a database
migrated to the migration before it, with a user, a book, an audit event, a `subscriptions` row, a `paddle_events` row
and a granted user, apply the drop. `subscriptions`, `paddle_events`, `users.pro_granted_at` and
`users.pro_granted_by` are gone, and the users, books and audit events are untouched.

**Acceptance criteria:**
- [ ] The migration applies with `pnpm db:migrate` on a local database, and `\d users` has no `pro_granted_*` column
- [ ] The new test case passes, and `0018_plans.sql` and `0019_billing.sql` are unchanged (checksums match)
- [ ] `user_books.starter` and `users.starter_book_at` are untouched

**Verification:**
- [ ] `pnpm db:migrate`, `pnpm test:db`

**Dependencies:** Task R0

**Files likely touched:** `db/migrations/00NN_drop_billing.sql`, `src/server/migrations.db.test.ts`, and the
`'subscriptions set null'` line in `src/server/admin/admin.db.test.ts`'s foreign-key test, which release 1 left there
because the table still points at `users` until the drop (see "Release 1 build notes")

**Estimated scope:** S

---

## Task R2: Full runs and commit

**Description:** Run the leftover check (only the release-2 expected hits remain), `pnpm check`, `pnpm test:db` and
`pnpm e2e:local`. Mark the Progress row "built, awaiting sign-off", and end this file with an empty sign-off line.
Commit the migration as one local commit on `main`. **Don't push.**

**Acceptance criteria:**
- [ ] The leftover check shows only the release-2 expected hits, and the three runs pass
- [ ] One local commit on `main`, separate from release 1's
- [ ] This file ends with `Signed off: ____ (date)`

**Verification:**
- [ ] The three full runs, and `git log origin/main..main --oneline`

**Dependencies:** Task R1

**Files likely touched:** `spec/capability-map.md`, this file

**Estimated scope:** XS

---

## Checkpoint: Release 2 complete
- [ ] Every success criterion in the spec is met except the owner's deploy checks and sign-off
- [ ] The final message lists the "Needs owner action" items first

---

## Release 1 build notes

Built 2026-11-25. Where the build left the plan's letter, and why:

- **Order.** Task 9's deletions broke imports that later tasks were meant to remove, so their pieces moved earlier:
  the home page's pricing, the account page's Plan section, the Terms edit (Task 12), the admin plan column and Pro
  grants (Task 11), and `plan.ts`'s `subscriptions` lookup (Task 13). `plans.spec.ts` was deleted in Task 4, when the
  Run code dialog lost the locator it used. Task 7's `pnpm check` was red on unit statements (91.99% against 92%) until
  Task 9 deleted the untested `use-checkout.ts`, as projected; it was green from then on.
- **One more leftover-check hit, kept on purpose.** `admin.db.test.ts` checks every foreign key to `users` against
  the account export's tables. `subscriptions` still has one until release 2, so the expected list names it on one
  line, with a comment. Task R1 removes that line.
- **Terms.** "Free and Pro" held one term that isn't billing: Ask, Translate and ElevenLabs run on your own keys under
  your agreements with those providers. That paragraph is kept word for word as its own part, "Your own API keys".
  Everything else billing in Terms and Privacy is removed, and both dates are 2026-11-25.
- **Home page.** The Hero's line is "Folio is free." The FAQ also loses "Is there a free trial?", whose answer was
  `NO_TRIAL`, and the header loses its Pricing link.
- **Flashcards.** "Delete all for this book" lived only on the Free counts page, and Pro's books page had no way to
  clear a removed book's cards. The counts page goes, and its button and notices move to the books page, so every
  reader keeps them. The button's accessible name now includes its visible text (axe flagged the old one).
- **Coverage.** Removing well-tested billing code took the server statements total below 96%, so tests were added,
  not floors lowered: ElevenLabs unreachable while listing voices, sign-in and sign-out with a failing database, a
  failed sign-in sweep, credentials read from disk, an Ask audit that can't be settled, and a server without
  `DATABASE_URL`. Final totals: unit 92.25 / 89.76 / 91.23 / 93.33, server 96.12 / 93.36 / 94.77 / 97.01
  (statements / branches / functions / lines), each at or above the Task 0 baseline.
- **Renames** go through TypeScript 7's language server (`tsc --lsp --stdio`, the `textDocument/rename` request that
  F2 sends), because TypeScript 7 has no JavaScript language-service API.

## Needs owner action

Each Paddle step applies only where its thing exists, and is skipped otherwise (spec Cut-over step 4).

**Before release 1 reaches production:**
- [ ] If a Paddle webhook destination exists (sandbox or live), remove it, so Paddle stops retrying against a 404.

**After the release-1 build:**
- [ ] Review the commits, push `main`, let CI deploy to dev, then deploy to production with `deploy-prod.yml`.
- [ ] Read the Terms and Privacy diffs, and the kept "Your own API keys" part of the Terms (see "Release 1 build
      notes"), before they go live.
- [ ] On dev and production: a member with no grant can use all seven features, `/account/plan`, `/refunds` and
      `/billing/paddle` answer 404, and the journal shows no error mentioning Paddle or the billing tables.
- [ ] Remove `PADDLE_*` lines from the server's env files, and the `paddle_api_key` and `paddle_webhook_secret`
      systemd credentials, on dev and production.
- [ ] If a timer or cron entry runs `scripts/billing/reconcile.ts`, remove it.
- [ ] If Paddle sandbox or live accounts exist, close them. There are no subscribers to refund or notify.
- [ ] Tell Claude release 1 is live on production, to start the release-2 build.

**After the release-2 build:**
- [ ] Before production applies the drop, take a backup:
      `pg_dump -t subscriptions -t paddle_events` and a copy of `users (id, pro_granted_at, pro_granted_by)`.
      Migrations are forward-only, so this is the only way back.
- [ ] Push `main`, let CI deploy to dev, then deploy to production. On both, `\d users` has no `pro_granted_*`
      column, and `subscriptions` and `paddle_events` don't exist.
- [ ] From then on, don't roll back to a build older than release 1. It reads `pro_granted_at`.
- [ ] Sign off. Claude fills in the line below, marks the Progress row done, and commits and pushes.
