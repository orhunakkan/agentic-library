# Implementation Plan: billing-removal

Source spec: [spec/SPEC-billing-removal.md](../spec/SPEC-billing-removal.md) (approved 2026-11-25)

Status: approved by the owner (2026-11-25)

Tasks: [tasks/billing-removal-todo.md](billing-removal-todo.md)

## Overview

Remove Paddle, the Free and Pro plans, every Pro gate, the pricing and checkout UI, `/refunds`, admin Pro grants,
billing config and `scripts/billing/`, so every signed-in account gets what Pro has today. This ships in two releases,
and each release is its own build:

- **Release 1 (code):** Tasks 0–14. The code stops reading and writing every billing table and column. It's built in
  one go and ends in local commits on `main`. The owner pushes, deploys and runs the cut-over steps.
- **Release 2 (drop migration):** Tasks R0–R2. It's built in a later session, only once the owner confirms release 1 is
  live on production. It adds one migration that drops the billing tables and columns.

## Facts checked while planning (2026-11-25)

These differ from the spec, or the spec didn't state them:

- **About 190 files change, not about 96.** 50 files are deleted. About 140 are edited, because every test that
  passes `plan` to a helper or expects `plan` in a response has to change too. The spec's own leftover `git grep`
  matches 103 files, and it misses `plan:` fields, `'pro'` states and copy such as "Running code is part of Pro."
  (`run-code.spec.ts`). The tasks are sized for this count.
- **`requirePro` has 10 call sites, not 9:** 8 `requirePro` and 2 `requireProText` (both in `highlights/export.ts`).
  **`canUse` has 6 call sites outside `plans/`, not 4:** `account-actions.ts`, `ask/setup.ts`, `flashcards/page.ts`
  (2), `speech/actions.ts` and the client's `run-code/run-access.ts`.
- **Two wire contracts are missing from the spec's table.** The ElevenLabs voice list answers `{ state: 'pro' }`
  (`speech/actions.ts:158`, typed in `shared/read-aloud/cloud.ts`), and Flashcards' page sends only counts to a Free
  reader (`flashcards/page.ts`). After the change, neither the `'pro'` state nor the counts-only branch is sent.
- **`/api/me` is registered under `GET`** in `src/routes/api/me.ts`, not `POST` as the spec says. Its handler uses the
  shared `.post` endpoint helper. The shape change (`plan` goes) is the same whichever method it is. The build tests
  it through the route that exists and doesn't change the method.
- **Both sign-in paths write to `paddle_events`.** `sign-in.ts` and `passkeys/sign-in.ts` call `sweepPaddleEvents`,
  and `login.db.test.ts` tests it. The spec doesn't list these files. They must change in release 1, or release 2's
  `drop table paddle_events` would break sign-in on the release still serving. `sign-in.ts` has a 100% coverage
  floor.
- **Dev deploys would fail on `/refunds`.** `scripts/smoke-dev.ts` expects `/refunds` to answer 200, and `ci.yml`
  runs `pnpm smoke:dev` in deploy-dev. Release 1 removes it from the list.
- **More tests list the deleted URLs:** `src/server/private-pages.test.ts`, `tests/e2e/specs/test-ids.spec.ts` and
  `tests/e2e/specs/signup.spec.ts` (the Refunds footer link).
- **`plans` and `billing` aren't Playwright projects.** They're entries in the phone project's `testMatch` list in
  `playwright.config.ts`. The `PADDLE_*` env is in the web server's env block.
- **The leftover `git grep` can't print nothing as written.** `.gitleaks.toml` keeps its Paddle allowlist on purpose
  (the spec's own "Changes to other specs"), `tasks/` describes the removal, and tests the spec asks for (the 404
  check, the leftover `PADDLE_*` config case, the release-2 migration test) and the drop migration itself must name
  what's gone. In release 1, `migrations.db.test.ts` still lists `subscriptions` and `paddle_events`, because the
  tables still exist. The check is run with fixed exclusions and an exact list of expected hits (see Decisions).
- **Deleting an account works without Paddle.** `subscriptions.user_id` and `users.pro_granted_by` are both
  `on delete set null`, so removing `detachUser` and `cancelBilling` doesn't block a delete. A leftover
  `subscriptions` row keeps its `customer_id` until release 2 drops the table. Only the owner's account exists.
- **Test helpers default to Pro.** `src/server/testing/users.ts`, `tests/e2e/support/accounts.ts` and `test-server.ts`
  default `plan` to `'pro'`, which sets `pro_granted_at` for members. So the existing feature tests already run as
  granted members. Once the parameter goes, they run as plain members. Admins are always Pro today, so a feature test
  that signs in as an admin proves nothing about members; Task 14 checks each feature has a member test.
- **The e2e truncate cascades.** Every `truncate users … cascade` also empties `subscriptions` through its foreign key,
  so `subscriptions` and `paddle_events` can leave the truncate lists in release 1 without breaking test setup.
- **One starter-book test depends on the Free limit.** `user-books.db.test.ts` checks that a former starter copy counts
  toward Free's 2 books. Starter code is out of scope and ask-first, so the case is rewritten against `MAX_BOOKS`
  (a starter copy plus 24 imports is 25, and the next is refused). That keeps the starter count covered without
  touching starter code.
- **Migrations are forward-only.** `scripts/db/migrate.ts` checksums and applies files in order. There are no down
  migrations, so a dropped table can only come back from a backup (see Risks).
- **The newest migration is `0028_openai_keys.sql`,** so the drop migration is `0029` unless another module adds one
  first. Task R0 works out the number.
- **`FREE_ARTICLES` is 20 and `PRO_ARTICLES` is 500.** Free's limits are 2 books and 50 highlights.
- **Postgres runs in the `agentic-pg` Docker container**, and Playwright in `pw-server`. Both were up while planning.

## Architecture Decisions

- **Gates go first, the plan type goes last.** Tasks 1–5 remove each feature's gate while the `Plan` type still exists,
  so every task leaves the app building and the tests green. Task 13 then deletes `Plan` and its modules, and the
  compiler finds every remaining reader. That's the spec's mitigation for hidden gates.
- **Each task removes the branch, not its result.** No task leaves `canUse` returning true, a `plan: 'pro'` constant or
  a flag. A gate is removed with the copy, the error case and the tests that only proved the refusal.
- **Inverted tests are written with the gate removal, not after.** Each feature task changes one existing db or e2e
  test so it signs in as a plain member with no grant and uses the feature. Each quota task does the same at the
  former Pro limit.
- **Paddle is cut from its callers before it's deleted.** Task 8 makes account deletion and sign-in stop calling
  Paddle code, Task 9 deletes the Paddle modules, and Task 10 removes the config, redaction, audit types and export key.
- **Release 1 stops every read and write of the four billing objects.** That includes the sign-in sweep, the
  account-data export, the session query, admin grants and the test helpers. Release 2's preflight proves it with a
  grep before the drop.
- **Renames are a separate commit.** CODE_STANDARDS.md and the spec say unclear names in touched functions are renamed
  in their own commit, with the editor's rename. The build uses TypeScript's own rename refactoring (the language
  service's `findRenameLocations`, which is what F2 runs), never find-and-replace. Release 1 is therefore one removal
  commit plus, if any names needed it, one rename commit after it.
- **Built in one go, reviewed once at the end.** Checkpoints are self-checks. Anything only the owner can do goes in
  the "Needs owner action" list, and the build carries on.

## Task List

### Release 1, Phase 1: Every feature for every member
- [ ] Task 0: Preflight
- [ ] Task 1: Ask and Ask prompts, ungated
- [ ] Task 2: Translate and Export, ungated
- [ ] Task 3: Audiobooks and ElevenLabs voices, ungated
- [ ] Task 4: Flashcards and Run code, ungated
- [ ] Task 5: Any account can save any API key

### Checkpoint: Features
- [ ] Self-check: no `requirePro`, `requireProText` or `canUse` call outside `src/server/plans/` and `src/shared/plans/`;
      `pnpm check` and `pnpm test:db` pass

### Release 1, Phase 2: One set of limits, and no Paddle
- [ ] Task 6: Book and audiobook quotas use the Pro limit
- [ ] Task 7: Highlight and article quotas use the Pro limits
- [ ] Task 8: Account deletion and sign-in stop calling Paddle
- [ ] Task 9: Delete the Paddle modules, routes, Pro page and billing tests
- [ ] Task 10: Billing config, redaction, audit types and export key go

### Checkpoint: No Paddle
- [ ] Self-check: nothing imports `billing/`; `@paddle/paddle-js` is gone; `pnpm check`, `pnpm test:db` and the
      e2e specs touched so far pass

### Release 1, Phase 3: No plan anywhere
- [ ] Task 11: Admin grants go
- [ ] Task 12: Pages and copy without plans or prices
- [ ] Task 13: Delete the plan concept
- [ ] Task 14: Proof matrix, leftover check, full runs and commit

### Checkpoint: Release 1 complete
- [ ] Every release-1 success criterion the build can check is met, and the rest are in "Needs owner action"

### Release 2 (later session, after the owner confirms release 1 is live on production)
- [ ] Task R0: Preflight for the drop
- [ ] Task R1: The drop migration and its test
- [ ] Task R2: Full runs and commit

### Checkpoint: Release 2 complete
- [ ] Every success criterion in the spec is met except the owner's deploy checks and sign-off

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A hidden gate stays, such as a client check on `viewer.plan === 'pro'` or a `'pro'` state | Med | Task 13 deletes `Plan`, so every reader is a type error. Task 14 runs the leftover grep and a second grep for `\bPro\b`, `'pro'` and `plan` in `src/`. |
| Coverage totals drop below a floor once well-tested billing code is gone | Med | Task 0 records the baseline totals. Each checkpoint runs coverage. Thin spots get tests. No floor is lowered (ask-first). A per-file floor for a deleted file is removed with the file, which isn't lowering a floor. |
| `sign-in.ts` (100% floor) or `redact.ts` (100% floor) loses coverage when a branch goes | Low | Removing the sweep and the `pdl_` pattern removes lines, not tests of what's left. The checkpoint runs `pnpm test:db` with per-file floors. |
| Release 2 drops a table the serving release still reads | High | Release 1 removes every reader and writer, including the sign-in sweep. Task R0 greps `src/` and `scripts/` and stops if anything but the migration test names them. The owner confirms release 1 is on production first. |
| The drop can't be undone: migrations are forward-only | Med | The owner takes a `pg_dump` of `subscriptions`, `paddle_events` and the two `users` columns on production before release 2 deploys ("Needs owner action"). |
| A deploy of a pre-release-1 build after release 2 reads `pro_granted_at` and fails | Med | After release 2, roll back only to release 1 or later. The report says so. |
| Paddle retries a webhook against a 404 for about two days | Low | The owner checks for a webhook destination and removes it before release 1 reaches production. |
| A flaky e2e spec (`sync.spec.ts:105` phone, `ask-prompts.spec.ts:88` desktop, `offline.spec.ts:30` desktop) fails a full run | Low | Rerun the spec on its own before debugging. |
| A cached offline client still reads `plan` | Low | It finds it missing and treats the reader as Free until its next update, which only hides features. Only the owner's account exists. |
| `instance-limits` adds a migration before release 2 | Low | Task R0 numbers the drop after the newest migration at that time. |

## Decisions

- **The leftover check runs with fixed exclusions and an exact list of expected hits.** The spec's `git grep` also
  excludes `.gitleaks.toml` and `tasks/`. Its expected hits after release 1 are: the 404 test's three URLs, the
  leftover `PADDLE_*` config case, and the `subscriptions` and `paddle_events` entries in `migrations.db.test.ts`.
  After release 2, they are: the drop migration and the release-2 case in `migrations.db.test.ts`. Any other hit fails
  the check. This is the closest the spec's "prints nothing" can be met. *(approved by the owner
  2026-11-25)*
- **The starter-copy quota test is rewritten against `MAX_BOOKS`**, not deleted, so starter counting stays covered
  without touching starter code. *(approved by the owner 2026-11-25)*
- **Release 1 is one removal commit, plus one rename commit if any names were renamed.** Release 2 is one commit.
  None of them are pushed. *(approved by the owner 2026-11-25)*
- **Renames use TypeScript's rename refactoring** through the language service, not find-and-replace.
  *(approved by the owner 2026-11-25)*
- **Plan files are named per module**, `tasks/<module>-plan.md` and `tasks/<module>-todo.md`. *(2026-11-25)*

## Open Questions

None.
