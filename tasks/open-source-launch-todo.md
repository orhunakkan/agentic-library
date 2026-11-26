# Tasks: the rest of the open-source launch

Plan: [tasks/open-source-launch-plan.md](open-source-launch-plan.md) · Specs:
[legal-and-attribution](../spec/SPEC-legal-and-attribution.md), [repo-security](../spec/SPEC-repo-security.md),
[contributor-docs](../spec/SPEC-contributor-docs.md), [go-public](../spec/SPEC-go-public.md)

**How this is built.**
- **Part 1 (Tasks 0 to 18) runs in one session, in one go.** The owner reviews the finished work once, at the end.
- **Checkpoints are self-checks.** If one fails, fix it and re-run it, and don't stop to ask.
- **Decide, don't ask.** On a spec gap, a step that doesn't fit the code, or two reasonable options, take your
  recommendation, carry on, and record the choice, the alternative and the reason under "Build notes".
- **Owner-only and ask-first items** go under "Needs owner action" and stay undone.
- **The only stop is Task 0.**
- **Part 2 (L1 to L12) is the launch.** It runs in a later sitting with the owner, and each GitHub or server step is
  approved on its own, as `go-public` requires.

**Boundaries for every task.**
- Follow [CODE_STANDARDS.md](../CODE_STANDARDS.md): descriptive names, `/** */` comments, no `any`. Parsed YAML, JSON
  and API responses start as `unknown` and are narrowed.
- Don't edit `src/routeTree.gen.ts` by hand, add or edit a migration, or lower a coverage floor.
- Never touch the server, its env files, GitHub settings (`--apply`), the runner, or `CI_RUNNER`.
- Never push, and never put a token, a key, an environment value or a personal email address in a file, a log or
  output.
- Never add `pull_request_target`, `workflow_run` or a comment trigger. Never register a self-hosted runner, and never
  add a secret.
- No new dependency other than `yaml` (devDependency, approved).
- When a touched function has unclear names, rename them in a separate `refactor:` commit, with the editor's rename.

**Skills to load** (memory: agent-skills for spec work):
- at the start: `agent-skills:incremental-implementation`;
- for logic: `agent-skills:test-driven-development`;
- Phase A: `agent-skills:security-and-hardening` (the cross-account operator tool);
- Phase B: `agent-skills:ci-cd-and-automation` and `agent-skills:security-and-hardening`;
- Phase C: `agent-skills:documentation-and-adrs`;
- before each commit: `agent-skills:code-review-and-quality` and `agent-skills:git-workflow-and-versioning`;
- on any failure: `agent-skills:debugging-and-error-recovery`;
- the launch: `agent-skills:shipping-and-launch` and `agent-skills:doubt-driven-development`.

**Per-task verification:**
- `pnpm check`;
- `pnpm test:db` when `src/server` changed;
- `pnpm test:browser` when a component or route changed;
- `pnpm build` when the build or a route changed.

`$SCRATCH` is the session's scratchpad.

---

## Task 0: Preflight

**Description:** Prove the build can run from start to end, and resolve every pin it needs. This is the only stop: if
anything here fails, say what's wrong and stop before any work.
- **The tree:** `main` is clean, and `git log origin/main..main` is empty. If the plan files and the capability
  map are the only changes, commit them first as `docs: plan the rest of the open-source launch`.
- **Postgres:** `agentic-pg` answers.
- **The gates:** `pnpm check`, `pnpm test:db`, `pnpm test:browser` and `pnpm build` pass on the untouched tree. Record
  the coverage totals in `$SCRATCH/baseline.txt`.
- **Tools:** the Docker daemon answers, `gh auth status` is fine, and `https://ghcr.io`, `https://www.gnu.org` and
  `https://www.contributor-covenant.org` are reachable.
- **The pins:** resolve these into `$SCRATCH/pins.txt`:
  - the 40-hex commit SHAs for `actions/checkout`, `actions/setup-node` and `pnpm/action-setup`, at their newest
    release in the current major, with annotated tags dereferenced;
  - the `@sha256:` digests for `mcr.microsoft.com/playwright:v1.64.1-noble` (check it matches the `playwright` package
    version), `postgres:18`, gitleaks v8.30.1 (it must equal the publish-audit digest) and the latest
    `ghcr.io/zizmorcore/zizmor`.

**Acceptance criteria:**
- [x] Tree clean and in sync. All four gates pass, and the baseline is recorded
- [x] Every pin in `$SCRATCH/pins.txt` is verified by a second command (`gh api …/commits/<sha>`, `docker buildx imagetools inspect <image>@<digest>`)

**Verification:** `$SCRATCH/pins.txt` and `$SCRATCH/baseline.txt` exist and are complete.

**Dependencies:** None · **Files:** none (scratch only) · **Scope:** XS

---

## Phase A: legal-and-attribution

## Task 1: `parseHttpsUrl`, `SOURCE_URL`, and `sourceUrl` in the nav data

**Description:**
- **The helper:** move the URL half of `parseSiteContact` into
  `parseHttpsUrl(value, name)` (spec, Code style), and add `sourceUrl: string | null` to the config from `SOURCE_URL`.
- **The nav data:** `getNavData()` returns `sourceUrl`, and `EMPTY_NAV` gets `sourceUrl: null`.
- **The prerendered shell** must not bake in a build-time value. Check how the shell is prerendered, and make sure it
  takes `null`.

**Acceptance criteria:**
- [x] `config.test.ts`: unset gives `null`, and a valid value is kept. `http://…`, a bare host, more than 200
      characters, and a value with spaces are each refused, naming `SOURCE_URL`. The existing `SITE_CONTACT` cases
      pass unchanged
- [x] `NavData` carries `sourceUrl` in both places it's derived (`__root.tsx`, `AppSidebar.tsx`)

**Verification:** `pnpm check`, `pnpm test:db`.

**Dependencies:** 0 · **Files:** `src/server/config.ts`, `config.test.ts`, `src/server/functions.ts`, `src/routes/__root.tsx` · **Scope:** S

## Task 2: Footers

**Description:**
- **The credit line:** `SITE_CREDIT` becomes the spec's new line.
- **SiteFooter** gains Copyright.
- **HomeFooter** gains Credits and Copyright.
- **Both footers** show "Source code" (`data-key="source"`, `rel="noopener"`, external) after the legal links when
  `sourceUrl` is set, and nothing when it isn't.
- **The comment:** the © line in HomeFooter gets the self-hoster `/** … */` comment (spec §8).
- **The link target:** the `/copyright` link needs the route from Task 3. Write Task 3's route file first, as a stub,
  if the router types need it.

**Acceptance criteria:**
- [x] New `*Footer.browser.test.tsx` for both footers. They check the credit line, the Copyright and Credits links,
      and the Source code link with and without `sourceUrl`
- [x] No "public domain or shared" text left in `src` (the spec's leftover `git grep`)

**Verification:** `pnpm check`, `pnpm test:browser`.

**Dependencies:** 1 · **Files:** `site.ts`, `SiteFooter.tsx`, `HomeFooter.tsx`, two browser tests · **Scope:** S

## Task 3: Terms rewrite, and the `/copyright` page

**Description:**
- **Terms** get the twelve parts, in the spec's order and with its ids (§1).
- **`src/routes/copyright.tsx`** is built like Terms, with the eight parts in §3.
- **`site.ts`:** add `COPYRIGHT_UPDATED`, and move `TERMS_UPDATED` to the build date.
- **Source links:** the Terms' `who` and the Copyright page's `code` link `sourceUrl` when set.
- **Cache and listing:** the Copyright page is public, cached like Terms, and listed in `private-pages.test.ts`.
- **Comments:** both files get the self-hoster comment.

**Acceptance criteria:**
- [x] Browser tests for Terms and Copyright check every part by id, the `SITE_CONTACT` contact link, the six notice
      elements on Copyright, and none of "Pro", "Paddle", "price", "subscription" or "refund"
- [x] `private-pages.test.ts` treats `/copyright` as public

**Verification:** `pnpm check`, `pnpm test:browser`, `pnpm build`.

**Dependencies:** 1 · **Files:** `terms.tsx`, `copyright.tsx` (new), `site.ts`, `private-pages.test.ts`, two browser tests · **Scope:** M

## Task 4: Privacy rewrite

**Description:**
- **The parts:** `without-account` becomes `visiting`, `with-account` gains the email confirmation, and there's a new
  `why` and a new `notices`. `who-else` gains its additions, `choices` becomes `rights`, and `children` and
  `questions` don't change (§2). Move `PRIVACY_UPDATED`, and add the self-hoster comment.
- **Check every data fact against the code,** including the one-year activity log, the 14-day access log, no cookie
  before sign-in, and logged searches and removals. Note each one checked in Build notes.

**Acceptance criteria:**
- [x] A Privacy browser test checks every part id, the contact link and the banned billing words
- [x] Every fact the page states is listed in Build notes with the file that makes it true

**Verification:** `pnpm check`, `pnpm test:browser`.

**Dependencies:** 3 · **Files:** `privacy.tsx`, `site.ts`, one browser test · **Scope:** S

## Task 5: The operator book tool

**Description:**
- **Audit events:** add `book.searched` and `book.removed` to `AuditEvent`.
- **`src/server/operator-books.ts`** (plan Decision 6):
  - `findBooks(db, text, reason)` matches title or author, ignoring case, across accounts. It returns id, username,
    kind, title, author and when it was added, and never content. It records `book.searched` with the text and reason.
  - `removeBook(db, id, reason)` uses `deleteBook` and then `forgetBookAudio`, exactly as the reader's own delete does.
    It records `book.removed` with the id, title, owner and reason, and returns the owner's username and confirmed
    address.
  - An empty reason throws. A missing id changes nothing.
- **`scripts/db/books.ts`** is the CLI from spec §4. It uses `getDb()` as `users.ts` does, and requires `--reason`.

**Acceptance criteria:**
- [x] `operator-books.db.test.ts` covers:
  - [x] a case-insensitive match on title and on author, across two accounts;
  - [x] the `book.searched` row with its reason;
  - [x] `removeBook` deleting the book, its pages and its pictures, recording `book.removed`, and returning the owner;
  - [x] a missing reason refused;
  - [x] a missing id changing nothing
- [x] Wrong arguments make the CLI print usage and exit non-zero, and no `--reason` makes it refuse

**Verification:** `pnpm check`, `pnpm test:db`. The server coverage floors hold.

**Dependencies:** 0 · **Files:** `audit.ts`, `operator-books.ts` (new), its db test, `scripts/db/books.ts` (new) · **Scope:** M

## Task 6: Third-party notices, and the Credits "Software" part

**Description:**
- **The plugin:** `thirdPartyNotices()` in `scripts/build/third-party-notices.ts` works as spec §7 describes, on the
  client build only. Its package lookup takes a root (plan Decision 7).
- **Overrides:** `scripts/build/licence-overrides.ts` holds `@diffusionstudio/piper-wasm` (GPL-3.0, with its source
  link), and `scripts/build/licences/GPL-3.0.txt` is fetched from gnu.org.
- **Registration:** the plugin is registered in `vite.config.ts`, and it adds the `ENGINES` packages.
- **Credits** gains the `software` part, which links `/third-party-licenses.txt` and says Folio's own code is MIT.
- **A package with no licence** that turns up in the real build gets an override with a reason. Record each one in
  Build notes.

**Acceptance criteria:**
- [x] `third-party-notices.test.ts` runs on a temporary fixture tree and covers:
  - [x] `?url` ids;
  - [x] a scoped package root;
  - [x] every licence-file name pattern;
  - [x] a package with no licence throwing, naming the package;
  - [x] an override supplying its text;
  - [x] sorted output, the same on every run
- [x] `pnpm build` writes `dist/client/third-party-licenses.txt`, which lists React, TanStack, the engine packages
      and the GPL-3.0 parts. Two builds give the same file (`cmp`)
- [x] The file is served with the short cache (`headersFor`), and a Credits browser test checks the link

**Verification:** `pnpm check`, `pnpm build` twice, `pnpm test:browser`.

**Dependencies:** 0 · **Files:** the plugin and its test, `licence-overrides.ts`, `licences/GPL-3.0.txt`, `vite.config.ts`, `credits.tsx`, one browser test · **Scope:** M

## Checkpoint A: legal-and-attribution (self-check, then commit 1)

- [x] `pnpm check`, `pnpm test:db`, `pnpm test:browser` and `pnpm build` pass, and no floor is below the baseline
- [x] The spec's leftover `git grep` prints nothing, and `SOURCE_URL=http://example.org pnpm dev` refuses to start,
      naming `SOURCE_URL`
- [x] The review (`code-review-and-quality`) has no required findings left
- [x] The Progress row for `legal-and-attribution` says "built, awaiting sign-off"
- [x] Commit 1: `feat: legal pages for a free service with open sign-up, a copyright page and third-party notices`

---

## Phase B: repo-security

## Task 7: The workflow guard test, red first

**Description:**
- **The dependency:** `pnpm add -D yaml`.
- **The test:** `tests/workflows.test.ts` checks the nine rules in spec §3, with the runner allowlist
  `ubuntu-24.04` and the write allowlist `deployments: write` on `request-dev-deploy` and `deploy-prod`.
- **The fixtures:** `tests/fixtures/workflows/` holds one failing workflow per rule, and each must fail with its
  rule's message.
- **Red first:** run it against today's workflows. It must fail on the runner, pinning and guard rules. Record what
  it says in Build notes.

**Acceptance criteria:**
- [x] Nine fixtures, and each fails with exactly its own rule's message
- [x] Today's `ci.yml` and `deploy-prod.yml` fail it, which proves it catches the real problems

**Verification:** `pnpm exec vitest run tests/workflows.test.ts` (red is expected until Task 8).

**Dependencies:** 0 · **Files:** `package.json`, lockfile, `tests/workflows.test.ts`, `tests/fixtures/workflows/*` · **Scope:** M

## Task 8: The workflows on GitHub-hosted runners

**Description:** Rewrite both workflows as spec §1 describes, with the pins from `$SCRATCH/pins.txt`.
- **Every job:** `runs-on: ubuntu-24.04`. The fork guards are gone, and checkout has `persist-credentials: false`.
- **`deploy-dev` becomes `request-dev-deploy`.** It runs on push to `main` only, after `db`, with
  `deployments: write`, and it creates a `dev` Deployment at `$GITHUB_SHA`. Its step summary keeps the
  "To promote it" line.
- **New jobs:** Secrets scan (gitleaks through `docker://`, plan Decision 9) and Workflow lint (zizmor).
- **`deploy-prod.yml`:**
  - the actor and triggering-actor guard;
  - the checks in plan Decision 11, each failing with its reason;
  - then a `production` Deployment.
- **Required checks:** keep the five job names exactly as listed in the spec, because they're the required checks.

**Acceptance criteria:**
- [x] `tests/workflows.test.ts` is green on the real workflows
- [x] zizmor (the pinned image, run locally on `.github/workflows`) reports nothing, or each accepted finding is in
      `.github/zizmor.yml` with a reason
- [x] The Secrets scan command, run locally with the job's arguments, passes on `main`'s history
- [x] No `secrets.`, no `vars.CI_RUNNER`, and no `/usr/local/bin` left in the workflows

**Verification:** `pnpm check` (the guard test is in `tests/`).

**Dependencies:** 7 · **Files:** `ci.yml`, `deploy-prod.yml`, maybe `.github/zizmor.yml` · **Scope:** M

## Task 9: The deploy poller

**Description:**
- **`scripts/deploy/decide.ts`** is a pure function. It takes the waiting deployments, `main`'s compare results, the
  CI runs and the environments' current statuses, and it returns one action: deploy, refuse with an enum reason,
  supersede (`inactive`), or already deployed (spec §2, plan Decision 10).
- **`scripts/deploy/poll.ts`** does the I/O:
  - it calls GitHub's REST API with `fetch`, using the token from `$CREDENTIALS_DIRECTORY/github_token`;
  - it sets `in_progress`, then `success` or `failure`;
  - it runs `sudo -n /usr/local/bin/agentic-library-deploy <dev|prod> <sha>`;
  - it takes the `flock`;
  - with `--dry-run`, it prints what it would do and changes nothing.
- **The systemd units:** `folio-deploy-poll.service` and `.timer`, with `LoadCredential=`, `User=folio-deploy`,
  hardening (`NoNewPrivileges=` stays off, because sudo needs it) and a 30-second timer.
- **No logs or values in statuses:** never put a token, a path or an env value in a status or in output.

**Acceptance criteria:**
- [x] `decide.test.ts` covers each refusal (a bad SHA, not on `main`, CI not green, production without a dev
      success), supersede for both environments, already deployed, and a valid deploy
- [x] `poll.ts --dry-run` without a token exits with a clear message and changes nothing

**Verification:** `pnpm exec vitest run scripts/deploy`, `pnpm check`.

**Dependencies:** 8 · **Files:** `decide.ts`, `decide.test.ts`, `poll.ts`, the two units · **Scope:** M

## Task 10: gitleaks in pre-commit, Dependabot, `minimumReleaseAge`

**Description:**
- **`.githooks/pre-commit`** scans the staged changes with `gitleaks` on `PATH`, or else with the pinned Docker image.
  If neither works, it prints one line saying the scan was skipped and carries on.
- **`.github/dependabot.yml`** follows spec §5.
- **`pnpm-workspace.yaml`** gains `minimumReleaseAge: 10080`.
- **The local canary** (plan Decision 15), in a scratch clone:
  - a key shaped like a real one, outside the allowlist, is refused by the hook;
  - the fake keys in the allowlist pass;
  - the clone is then deleted.

**Acceptance criteria:**
- [x] The canary is refused, the allowlisted fakes pass, and the skip line prints when `PATH` and Docker are both
      hidden
- [x] `pnpm install --frozen-lockfile` still works with `minimumReleaseAge` set

**Verification:** `pnpm check`, plus the scratch-clone runs recorded in Build notes.

**Dependencies:** 8 · **Files:** `.githooks/pre-commit`, `.github/dependabot.yml`, `pnpm-workspace.yaml` · **Scope:** S

## Task 11: GitHub settings as code

**Description:**
- **`.github/rulesets/`** holds `main-history.json` and `main-changes.json`, in GitHub's import format:
  - `main-changes` requires the five checks from integration 15368, squash only, 0 approvals, with an admin bypass;
  - `main-history` has no bypass.
- **`scripts/github/desired.ts`** holds every row of spec §6's table as typed data, each marked "needs public" where
  the spec says it's applied by `go-public`.
- **`scripts/github/settings.ts`:**
  - `--check` prints each difference and exits non-zero if there are any;
  - `--apply` sets them;
  - it runs `gh` as a subprocess and never handles a token. Responses are `unknown` and narrowed.
- **The diff** is a pure function tested on fixtures in `scripts/github/fixtures/`.
- **Read-only against the current repo:** run `--check` and record the diff in Build notes (plan Decision 16).
  Differences in rows other than the "needs public" ones are expected until the owner's cut-over, for example the
  runner, `CI_RUNNER` and allowed actions.

**Acceptance criteria:**
- [x] `settings.test.ts` covers matching, differing and missing settings, and unreadable or unexpected API shapes
- [x] `--check` runs against the live repo and changes nothing. Its output is recorded

**Verification:** `pnpm exec vitest run scripts/github`, `pnpm check`.

**Dependencies:** 8 · **Files:** two rulesets, `desired.ts`, `settings.ts`, `settings.test.ts`, fixtures · **Scope:** M

## Task 12: `SECURITY.md`

**Description:** Write the six points of spec §7. Link private vulnerability reporting at
`https://github.com/orhunakkan/agentic-library/security/advisories/new`.

**Acceptance criteria:**
- [x] Every point in §7 is present, and there's no email address

**Verification:** read it against §7.

**Dependencies:** None · **Files:** `SECURITY.md` · **Scope:** XS

## Checkpoint B: repo-security (self-check, then commit 2)

- [x] `pnpm check` passes, with the guard, decide and settings tests in it. `pnpm test:db`, `pnpm test:browser` and
      `pnpm build` still pass
- [x] zizmor is clean, and the pre-commit hook passes on this commit
- [x] The review (`code-review-and-quality` and `security-and-hardening`) has no required findings left
- [x] The Progress row for `repo-security` says "built, awaiting sign-off (needs the owner's cut-over)"
- [x] Commit 2: `ci: move CI to GitHub-hosted runners and deploy through a server-side poller`

---

## Phase C: contributor-docs

## Task 13: Licence

**Description:** `LICENSE` holds the standard MIT text with `Copyright (c) 2026 Orhun Akkan` and nothing else.
`package.json` gets `"license": "MIT"`, and `"private": true` stays.

**Acceptance criteria:**
- [x] The text matches SPDX MIT exactly, apart from the copyright line

**Verification:** `diff` against the SPDX text, then `pnpm check`.

**Dependencies:** 0 · **Files:** `LICENSE`, `package.json` · **Scope:** XS

## Task 14: Compose, `.env.example`, and the env drift test

**Description:**
- **`compose.yaml`** follows spec §7, with `postgres` pinned to the same digest as `ci.yml`.
- **`db/local/create-test-database.sql`** creates `agentic_test` on first start.
- **`.env.example`** follows spec §6, with every setting in the plan's list:
  - `NODE_ENV` included and `CREDENTIALS_DIRECTORY` left out (plan Decision 12);
  - `SOURCE_URL` with its hosted value in the comment;
  - the `LIMIT_*` settings with their defaults and hosted values;
  - secrets empty.
- **`tests/env-example.test.ts`** follows spec §8, with in-memory failing cases.

**Acceptance criteria:**
- [x] The test passes, and fails naming the setting when a line is removed or an unread setting is added
- [x] `FOLIO_DB_PORT=55432 docker compose -p folio-walkthrough up -d --wait` starts Postgres on `127.0.0.1:55432`
      only, with both databases. Then run `down -v`

**Verification:** `pnpm check`, plus the compose run.

**Dependencies:** 8 (digest), 1 (`SOURCE_URL`) · **Files:** `compose.yaml`, `db/local/create-test-database.sql`, `.env.example`, `tests/env-example.test.ts` · **Scope:** M

## Task 15: README, CONTRIBUTING, the docs drift test, the CLAUDE.md line

**Description:**
- **README** has the sections in spec §2's order. Take the intro and features from `HERO_LINE` and the home page's
  feature sections, the limits from `instance-limits`, and add the GPL-3.0 note.
- **CONTRIBUTING** has the sections in §3.
- **`tests/docs.test.ts`** follows §8.
- **CLAUDE.md** gains the compose line in Commands.
- **Take facts from the code, not memory.** Link instead of copying, and never mention plans, prices or Paddle.

**Acceptance criteria:**
- [x] `docs.test.ts` passes. In-memory cases fail on a broken link, an unknown `pnpm` script, an unpinned or
      non-loopback compose file, and a banned word
- [x] Every README and CONTRIBUTING section in §2 and §3 is present

**Verification:** `pnpm check`.

**Dependencies:** 12, 13, 14 · **Files:** `README.md`, `CONTRIBUTING.md`, `tests/docs.test.ts`, `CLAUDE.md` · **Scope:** M

## Task 16: Code of Conduct, issue forms, PR template

**Description:**
- **`CODE_OF_CONDUCT.md`** is Contributor Covenant 2.1, fetched verbatim. Its contact is the Privacy-page link (plan
  Decision 13), and its scope is the repository's GitHub spaces.
- **`.github/ISSUE_TEMPLATE/`** holds `config.yml` (no blank issues, three contact links), `bug_report.yml` and
  `feature_request.yml`, as §5 describes.
- **`.github/pull_request_template.md`** has the §5 checklist.

**Acceptance criteria:**
- [x] The Covenant text differs from the fetched source only in the contact placeholder
- [x] The issue forms parse with `yaml`, and the docs test covers the PR template's links

**Verification:** `pnpm check`.

**Dependencies:** 15 · **Files:** five files · **Scope:** S

## Task 17: Fresh-clone walkthrough

**Description:** This is the spec's acceptance test, run in `$SCRATCH/walkthrough`.
- **Start clean:** a `git clone --no-local` of the working tree at the current commit, with no `.env` and a new
  compose project `folio-walkthrough` on `FOLIO_DB_PORT=55432` (plan Decision 14).
- **Follow the docs word for word:** the README quick start, then CONTRIBUTING's setup, with only the port change that
  CONTRIBUTING documents.
- **Reach the goals:**
  - `pnpm dev` serves `http://localhost:3000`, on another port if 3000 is taken, as recorded;
  - the admin made with `db:users create` can sign in, checked with a request to the login endpoint;
  - `pnpm check`, `pnpm test:db` and `pnpm test:browser` pass.
- **Fix what fails:** for each step that didn't work as written, fix the doc and re-run that step.
- **Clean up:** `down -v` on that project, then remove the clone.

**Acceptance criteria:**
- [x] Every goal is reached, and every doc fix is listed in Build notes
- [x] `agentic-pg` and the owner's `agentic_dev` are untouched

**Verification:** the walkthrough log in Build notes.

**Dependencies:** 13 to 16 · **Files:** doc fixes only · **Scope:** M

## Checkpoint C: contributor-docs (self-check, then commit 3)

- [x] `pnpm check` passes, with both drift tests in it
- [x] The review has no required findings left
- [x] The Progress row for `contributor-docs` says "built, awaiting sign-off"
- [x] Commit 3: `docs: add the MIT licence, README, contributing guide and local Postgres`

---

## Task 18: Full CI-parity run, final review, hand-over

**Description:**
- **Every CI gate, run locally on the final tree, as CI runs it:**
  - `pnpm install --frozen-lockfile`, `pnpm exec biome ci .`, `pnpm typecheck` and `pnpm test`;
  - `pnpm build` and `pnpm audit`;
  - `pnpm test:browser` and `pnpm test:db`;
  - the guard test, zizmor and the Secrets scan.
- **Coverage:** compare the totals with the baseline.
- **The status files:** each built spec's `Status:` line says "implemented, awaiting sign-off".
- **The hand-over list:** finish Build notes and Needs owner action, then print the owner's list, ordered.
- **Commit and push:** commit status-file changes as `docs: mark the build of the remaining modules done`. Don't push.

**Acceptance criteria:**
- [x] Every gate is green, and no coverage floor is below the baseline
- [x] `git log origin/main..main` shows the three module commits, plus any `refactor:` and the docs commit
- [x] Nothing in the diff contains a token, key, env value, personal email, or server path other than
      `/usr/local/bin/agentic-library-deploy` and `/opt/folio-deploy/` (accepted, plan Decision 10)

**Verification:** the gate outputs in Build notes.

**Dependencies:** Checkpoint C · **Scope:** S

## Checkpoint: Build complete

- [x] Every Part 1 box is ticked, Build notes are complete, and the owner's list is current

---

## Part 2: the launch (go-public)

Run in a later sitting with the owner. Each step follows [SPEC-go-public.md](../spec/SPEC-go-public.md) exactly: its
commands, its checks and its abort path. Each GitHub or server change needs the owner's approval on its own, and
approval for one doesn't cover the next. Results go in `spec/go-public-report.md`, one entry per step, in the spec's
format.

**Launch preconditions** (all must hold, checked with commands, before L1):
- [ ] The three built modules are signed off, pushed, and live on dev and production. The last CI on `main` is green
      on GitHub-hosted runners, and both sites run its tip, deployed by the poller
- [ ] The repo-security cut-over (owner list, part B) is done, with no runner and no `CI_RUNNER`
- [ ] The `instance-limits` hosted values are live (owner list, part A)
- [ ] The owner's global `user.email` is the no-reply address, and "Block command line pushes that expose my email" is on
- [ ] The owner has confirmed that the deploy script fetches a SHA rather than fast-forwarding a branch
- [ ] The tree is clean, `main` is the only branch, and there are no stashes, worktrees, tags or open PRs
- [ ] `settings.ts --check` differs only in the "needs public" rows

**Steps:**
- [ ] L1: final audit re-run, which adds "Re-run before go-public" to the audit report (Claude)
- [ ] L2: commit the report, then bundle the old `main` to `~/backups/` and verify it (Claude)
- [ ] L3: mailmap rewrite in `$SCRATCH/public`, with the `cmp` proof (Claude)
- [ ] L4: stop the poller timer (owner). Then delete the deploy key, turn Actions off and rename to
      `agentic-library-archive` (Claude, approved one by one)
- [ ] L5: create the new private repo with the About text and topics. Then add the deploy key, run `--apply` and
      `--check`, push `main` only, and check with `ls-remote`
- [ ] L6: switch the local clone, then expire the reflog and gc. The freeze ends
- [ ] L7: new token (owner). Then the mirror-clone audit, CI green, the dev deploy, the production deploy (owner), and
      `/healthz` on both. Go/no-go
- [ ] L8: make it public (owner's explicit go). Then `--apply` and `--check` until there are no differences, the rules
      API, and the licence `mit`
- [ ] L9: `SOURCE_URL` on both sites (owner). Then the footer links, Community standards at 100%, and the issue chooser
- [ ] L10: archive the old repo. Revoke the old token (owner)
- [ ] L11: the sign-up go/no-go, then `SIGNUP=open` with the rehearsal, dev first, then production
- [ ] L12: watch for 7 days (owner). Mark `go-public` built in the map, and set the spec's status to implemented

---

## Build notes

Filled in by the build: each decision, its alternative and the reason, plus the facts checked and the results.

1. **Task 0 (preflight).** Tree clean and in sync with `origin/main` at `1a4dcec7`. `agentic-pg` answered. Docker 29.9.2, `gh` logged in, and ghcr.io, gnu.org and contributor-covenant.org were reachable (gnu.org's licence file needed a long timeout, and arrived intact: 35,149 bytes, sha256 `3972dc97…6986`). All four gates passed on the untouched tree: check 3,354 tests, test:db 1,727, test:browser 57, build. Coverage baseline: unit 92.26 / 89.79 / 91.25 / 93.35, server 96.16 / 93.40 / 94.85 / 97.02 (statements / branches / functions / lines). Pins, each verified by a second command:
   - `actions/checkout` v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1`, `actions/setup-node` v7.1.0 `949feb2413d6458794dcd2491c4babbbce0c15c1`, `pnpm/action-setup` v6.1.1 `73e46992e05b19abd31f2f3c20e0e7370d762115`;
   - `mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a7…768f` (matches `playwright` 1.64.1), `postgres:18@sha256:c6993038…0b6b`, gitleaks v8.30.1 `@sha256:c00b6bd0…b7f` (equals the publish-audit digest), zizmor 1.33.1 (latest) `@sha256:ecd3ffe6…c516`.
2. **Legal text stays in the route files** (`terms.tsx`, `privacy.tsx`, `copyright.tsx`), as the spec's file list, leftover `git grep` and the README section expect. To test them, `mountRoute()` in `src/client/testing/router.tsx` attaches the real file route under a stand-in root, the way `routeTree.gen.ts` does. *Alternative:* move the text into exported components, which would split the self-hoster comments from the routes, or export components from route files, which defeats code splitting.
3. **The pages read `sourceUrl` from the root loader** (`useLoaderData({ from: '__root__' })`), and the footers take it as a prop. The shell can't bake a build-time value in: `prerenderEnv()` deletes `SOURCE_URL` before the build. An older cached nav without `sourceUrl` simply shows no link.
4. **`pnpm dev` now refuses to start on a bad setting**, naming it, as `pnpm start` already did (`refuseBadConfig()` in `vite.config.ts`). Before this, dev started and every page answered 500. The spec's check `SOURCE_URL=http://example.org pnpm dev` now exits 1 with "SOURCE_URL must be an https:// URL of at most 200 characters". *Alternative:* accept the 500, which doesn't match "refuses to start".
5. **Credits already had a part with id `software`** (the voice engines). The new "Software Folio is built on" part takes that id, and the engine list sits under it as "The Folio voice runs on:", so there's one part, not two with the same id.
6. **Terms wording.** The `use` part keeps today's four rules and adds the spec's three as separate bullets. "Ask, Translate and ElevenLabs" reads "Ask the book, Translate and ElevenLabs voices", as the app names them. The `ending` part adds "from your account page", which is where deleting happens.
7. **The operator tool** (Decision 6): `src/server/operator-books.ts` with `src/server/operator-books.db.test.ts` (8 tests), and the thin CLI `scripts/db/books.ts`. Matching uses `strpos(lower(…), lower(…))`, so `%` and `_` are plain text. Search text is required, as well as the reason. A malformed or missing id returns null and records nothing. The CLI, like `users.ts`, adds `via` and `osUser` to the event, and it doesn't load `.env` (the spec's command is `node scripts/db/books.ts`). Run it on the server as `node --env-file=<env file> scripts/db/books.ts …`. Checked by hand against the test database: no command, no `<text>`, an empty or missing `--reason` and extra words each print usage and exit 1.
8. **Third-party notices.** The plugin comes in two halves sharing one set of ids: `client` (in `plugins`) and `worker` (in `worker.plugins`), because Vite bundles `piper.worker.ts` in a build of its own. It also reads the `originalFileNames` of emitted assets, so the fonts a stylesheet imports are listed (7 `@fontsource` packages, OFL-1.1). These never appear in chunk module ids. The real build lists 61 packages, and two builds gave the same file (`cmp`).
9. **Overrides added because the real build failed on them** (each text fetched, never typed):
   - `@diffusionstudio/piper-wasm`: GPL-3.0, from gnu.org (the known one);
   - `onnxruntime-web` and `onnxruntime-common`: MIT. Neither npm package ships a licence file, and `github.com/microsoft/onnxruntime` answered 404 from here, so the text is `onnxruntime/LICENSE` from Microsoft's own onnxruntime 1.31.1 wheel on PyPI;
   - `pyodide`: MPL-2.0 (its LICENSE at tag `314.0.8`) plus CPython's LICENSE at `v3.14.2`, because `python_stdlib.zip` is CPython 3.14.2's standard library (`pyodide-lock.json`);
   - `@sqlite.org/sqlite-wasm`: Apache-2.0 from apache.org. Its tag `3.54.1-build1` has no LICENSE file, and SQLite itself is public domain, which the note says.
10. **Noticed, not touched:** Credits links onnxruntime's licence at `github.com/microsoft/onnxruntime/blob/v1.31.1/LICENSE`, which answered 404 from here (`ENGINE_SOFTWARE` in `folio-voices.ts`). Worth checking in a browser.
11. **Privacy facts, each checked against the code:**
    - no cookie before sign-in: `set-cookie` is only sent by sign-in (`account-actions.ts`), passkey sign-in (`passkeys/sign-in.ts`) and finishing sign-up (`signup/actions.ts`);
    - the activity log is kept a year: `sweepAuditEvents` deletes after 365 days (`audit.ts`);
    - searches and removals are logged with the reason: `book.searched` and `book.removed` (`operator-books.ts`);
    - sign-up confirms the address with a link: `mailLink` and `signupHref` (`signup/actions.ts`). An unfinished sign-up's address goes after 7 days (`signup/store.ts`);
    - sign-in attempts are kept 30 days (`login-attempts.ts`);
    - settings and reading places stay in the browser until you sign in: kept in local storage and synced only with a session (`features/sync`);
    - not in the code, so facts about agenticlibrary.app's infrastructure, kept from today's page: Cloudflare, the 14-day access log, "no backups yet", and the notice emails kept at most 3 years. The self-hoster comment at the top of `privacy.tsx` says so.
12. **Phase A review fixes** (independent `code-reviewer` pass, two Required and the rest taken):
    - the notices plugin now strips Vite's `\0` prefix before it makes a path absolute, so a virtual id can't skip a package silently. A test runs the real `generateBundle` hooks with such an id;
    - Privacy now says what the removal record keeps (the reason, the title and the owner's username, for a year, even after the account is deleted), and the activity-log bullet names it as the one exception to "never your text";
    - `findBooks` needs at least 3 characters, so one command can't list every library;
    - the removal and its `book.removed` row are one transaction, with the row locked (`for update`), and the audio files are removed after it commits;
    - an override that meets a real licence file now fails the build, so a fixed upstream package is noticed;
    - `parseArgs` errors print usage, the caller's `detail` can't overwrite `reason` or `text`, the GPL header matches `GPL-3.0` only, `SITE_CONTACT`'s fuller message is back, the build's notices use the server's own `parseHttpsUrl`, the `added` column says UTC, and `pnpm db:books` loads `.env` like `db:users`.
    - *Noted for the owner:* Terms, Credits and the notices header say the code is MIT from commit 1, but `LICENSE` and `package.json` only say so from commit 3. Push all three together.
13. **Guard test, red first (Task 7).** On today's workflows it failed with 20 problems:
    - `ci.yml`: `[runner]` on all four jobs (`${{ vars.CI_RUNNER }}`), `[action-pin]` for 9 `uses:` (`@v7` and `@v6` tags), `[image-pin]` for the Playwright container (twice) and `postgres:18`, and `[checkout-credentials]` on three checkouts;
    - `deploy-prod.yml`: `[runner]`.
    Each of the 9 fixtures fails with its own rule only, and a test checks there's exactly one fixture per rule. The fork guards weren't a rule (the spec drops them), so they aren't checked for.
14. **Workflows (Task 8):**
    - **Secrets scan:** the range comes in through `env:` and is checked in shell. An empty or all-zeros base scans `--all`, which also covers `workflow_dispatch`. gitleaks runs as a `docker://` step (Decision 9).
    - **Workflow lint:** runs zizmor with `--offline`. The job has no token, so online audits couldn't run anyway, and the flag makes that explicit. zizmor reports nothing even with `--persona pedantic`, after the job permissions got explanatory comments, so there's no `.github/zizmor.yml`.
    - **request-dev-deploy** needs `db`, Secrets scan and Workflow lint, not only `db`: a commit that fails either scan isn't offered to the server. The poller checks CI's whole run in any case. It creates the deployment with `required_contexts: []`, so GitHub doesn't refuse it while this run's own checks are still in progress. Its step summary keeps the "To promote it" line.
    - **deploy-prod.yml's** job is now named "Request the production deploy". It isn't a required check.
    - **The coverage summaries** still pass `github.event.*` through `env:`, unchanged.
    - **Local checks:** gitleaks with the job's arguments passed on `main`'s history, both as `--all` (90 commits) and as a range. zizmor was clean. No `secrets.`, `vars.CI_RUNNER` or `/usr/local/bin` is left in the workflows.
15. **The poller (Task 9):**
    - **decide.ts:** `decide()` is pure, with 13 tests. A request is waiting while it has no status, or only `pending` or `queued`. `in_progress` counts as not waiting, because a run that stopped mid-deploy leaves it, and deploying again blindly is worse than the owner reading the journal.
    - **Order of checks:** validation comes before "already deployed", so an invalid request for the live SHA is still refused.
    - **Live SHA and dev success:** the live SHA is the newest deployment whose latest status is `success`. Statuses are posted with `auto_inactive: false`, and "dev succeeded" looks at every status, not only the latest.
    - **The lock:** poll.ts re-runs itself under `flock -n -E 75` on `$RUNTIME_DIRECTORY/folio-deploy-poll.lock`. A run that finds it taken stops quietly. systemd also never starts the oneshot twice at once.
    - **The units:** `systemd-analyze verify` passes. Hardening is lighter than planned: the deploy script runs as a child of the service through sudo, and inherits its sandbox. So `ProtectSystem=`, `ProtectHome=`, `PrivateTmp=`, `PrivateDevices=` and `UMask=` are left out, because each could make the deploy's files read-only, hidden or unreadable. The kernel, clock and hostname protections stay. *Alternative:* full hardening, which would need the deploy started outside the sandbox (for example through `systemd-run`).
    - **Checks run:** `poll.ts --dry-run` without a token prints "no GitHub token: … Nothing was changed." and exits 1. A live dry-run needs the server token, so it's owner action.
16. **pnpm 12 applies `minimumReleaseAge` to frozen installs too** (the spec assumed it didn't). `openai@7.62.0`, published 2026-11-20 and already in the lockfile, failed `pnpm install --frozen-lockfile`. It's listed in `minimumReleaseAgeExclude` by exact version, with a comment to remove it once it's a week old (after 2026-11-27). *Alternative:* downgrade openai, or drop the policy.
17. **Pre-commit canary (Task 10)**, in a scratch clone, since deleted:
    - a random `ghp_`-shaped token was refused by the hook (exit 1, "leaks found: 1"), and the Secrets scan job's command failed on the commit;
    - the allowlisted fakes (`re_test_…`, `ghp_0123…`) passed;
    - with gitleaks and Docker both hidden from `PATH`, the hook printed "pre-commit: secrets scan skipped (no gitleaks on PATH and no Docker); CI's Secrets scan still runs" and carried on.
    The scan runs first in the hook, so a leak stops the commit before the slower steps.
18. **Settings as code (Task 11):**
    - **Design:** `desired.ts` holds 20 rows. Each environment is two rows: its branch policy type, and "main and only main". Comparison is "holds": objects may have more fields, while lists must match item for item, in any order. A ruleset is compared on the fields its import file sets.
    - **By hand:** runners, variables, secrets, collaborators and deploy keys are owner steps, because each fix is a deletion. `--apply` prints them and never runs them.
    - **Tests:** 8 tests on two recorded fixtures (`public-matching.json` and `private-today.json`, made-up repo `example/folio`). They cover matching, differing, missing and unreadable answers, and check that the five required checks are `ci.yml`'s job names.
    - **Live `--check`, read-only, against the current repo** (nothing changed). 12 differences:
      - 5 in rows applied by go-public: the two rulesets (403, private), secret scanning (null while private), private vulnerability reporting (404) and fork PR approval (422, private);
      - 7 that the cut-over fixes: Dependabot alerts (off), Dependabot security updates (off), Actions `allowed_actions: "all"` with `sha_pinning_required: false`, selected actions (409, because all are allowed), one self-hosted runner, one variable (`CI_RUNNER`), and Projects on.
      - Already matching: workflow token, secrets, collaborators, deploy keys, and both environments.
19. **SECURITY.md (Task 12)** covers the six points of §7, and has no email address.
20. **Phase B security review** (independent `security-auditor` pass). It found no way to deploy a SHA that isn't on main or didn't pass CI. Fixed before commit 2:
    - **(High) CI race.** The dev request is made from inside the CI run it depends on, so the run's conclusion is still empty when the poller looks. A refusal there would have been permanent. CI now has three states (`passed`, `pending`, `failed`, from `ciStateOf`), and `pending` is a `wait` action that sets no status. Tests cover both.
    - **(Medium) Forged "tested on dev".** Anyone with `deployments: write`, including the server token, can post a `success` status. "Dev deployed it" and the live SHA now come from the server's own record, `$STATE_DIRECTORY/deployed.jsonl` (`StateDirectory=folio-deploy-poll`), appended after each successful deploy script run. A torn line never counts.
      - Consequence: the first production deploy after the cut-over needs a dev deploy made by the poller first, which cut-over step 3 does anyway.
    - **(Medium) Rate limit.** A pass made about 62 calls. It now reads 10 requests per environment, newest first, and stops at the first that isn't waiting. It no longer reads every status, so a typical pass makes 4 to 8 calls.
      - Each environment's pass is wrapped on its own, so a failure in dev doesn't stop production.
      - The final status after a deploy is retried up to 4 times.
      - Trade-off: an older request left waiting behind a newer, finished one is never looked at.
    - **(Low) Pre-commit in a worktree** scanned nothing and exited 0. The hook now pipes `git diff --cached -U0` into `gitleaks stdin`. Re-tested in a scratch clone and a linked worktree: the canary was refused (exit 1) and the fake passed, in both.
    - **(Low) Guard test gaps:**
      - pins are now checked on the parsed `uses:` of steps and jobs, with the `# v…` comment found on that value's own line. Flow style, quoted keys and a value on the next line are caught;
      - untrusted values are found by token inside every `${{ }}`, in `run:` and in `with.script`;
      - checkout is matched case-insensitively, and `secrets[…]` and `toJSON(secrets)` are caught;
      - the write allowlist is keyed by `file:job`, and such a job may run no checkout or action.
      Six in-memory probe tests cover these.
    - **(Low) settings.ts:**
      - security updates must also be not `paused`;
      - branch policies are matched on name and type;
      - new rows for pending invitations, environment secrets and variables (both environments), and Dependabot and Codespaces secrets, which is 27 rows in all;
      - list reads use `per_page=100`.
      The live `--check` still shows the same 12 differences, and every new row matches.
    - **(Info) zizmor now runs online** with the job's read-only `GITHUB_TOKEN`, so impostor commits and tag/SHA mismatches are checked. Locally it's clean both offline (pedantic) and online.
    - **(Info) The Secrets scan reads `.gitleaks.toml` from the base commit,** so a PR can't allowlist its own findings.
    - **Left as they are, and noted:**
      - a deliberate rollback to any CI-green commit on main is allowed (Decision 10);
      - the `db` job's log shows the throwaway service-container `DATABASE_URL` (accepted);
      - the sudoers argument pin and a root-owned `/opt/folio-deploy` are in the unit's comments and the owner's list;
      - `TimeoutStartSec=25min` kills a deploy that runs longer;
      - whether the environments' "main only" branch policy accepts REST-made deployments with a SHA `ref` is only known at cut-over step 3.
21. **LICENSE (Task 13)** is SPDX's MIT text (`spdx/license-list-data`, `text/MIT.txt`), fetched. `diff` against it shows only the copyright line. `package.json` says `"license": "MIT"`, and `"private": true` stays.
22. **compose.yaml (Task 14)** follows §7, with one change: the healthcheck runs `pg_isready -h 127.0.0.1 …`, not over the socket. While the init scripts run, the official image serves the Unix socket only, so a socket check could pass before `agentic_test` exists. Checked with `FOLIO_DB_PORT=55432 docker compose -p folio-walkthrough up -d --wait`: port `127.0.0.1:55432` only, with `agentic_dev` and `agentic_test`, then `down -v`. `agentic-pg` was untouched.
23. **.env.example** lists the 41 settings the code reads. `NODE_ENV` is commented, and `CREDENTIALS_DIRECTORY` is left out, so the drift test excludes it with `USER` and `USERNAME` (Decision 12). The hosted `SITE_CONTACT` is described, not written, because no address goes in a committed file. Copying it to `.env` gives a config that `parseConfig` accepts (checked).
    - The drift test (`tests/env-example.test.ts`, 6 tests) checks that the settings listed are exactly those read, that secrets are empty, and that no value is shaped like a real key. Each check has an in-memory failing case.
24. **Docs (Task 15):**
    - **README:** the features come from the home page's five feature sections only. The "Storybook" panel is marked "In the works", so it's left out.
    - **CONTRIBUTING:** has every section of §3, plus a line on what the Code of Conduct covers (see 26).
    - **The docs drift test** (`tests/docs.test.ts`, 29 tests) checks links, `pnpm` scripts, the licence, compose's pin and binding, and billing words. Billing words count in the docs, the issue forms and `.env.example`, matched as whole words, so "Projects" and "providers" pass. It also parses the issue forms and checks the three contact links.
    - **CLAUDE.md** gains only the compose line.
25. **The PR template's link to CONTRIBUTING.md is absolute.** A relative link in a pull request's description resolves against the pull request's page, so it would break. The docs test still checks the template for relative links.
26. **Code of Conduct (Task 16):** Contributor Covenant 2.1, fetched from contributor-covenant.org. `diff` shows only the contact placeholder, which became "the contact shown at https://agenticlibrary.app/privacy#questions" (Decision 13). The spec also asks the CoC to say it covers the repository's GitHub spaces. That would change the Covenant's own text, so the scope is stated in CONTRIBUTING's "Before you start" instead. *Alternative:* a preface paragraph above the Covenant.
27. **Fresh-clone walkthrough (Task 17).** The clone was `git clone --no-local` of the working tree, with the uncommitted Phase B and C changes laid over it, in the scratchpad. It had no `.env`, used compose project `folio-walkthrough` with `FOLIO_DB_PORT=55432`, and followed the README quick start and then CONTRIBUTING's setup as written:
    - `pnpm install`, compose `up -d --wait`, `cp .env.example .env`, the `openssl` KEK pasted after `KEK=`, the `.env` port changed to 55432, `pnpm db:migrate`, and `pnpm db:users create walker --role admin` all succeeded. The password was never printed;
    - `pnpm dev` served `http://localhost:3000` (3000 was free). `POST /login` with that account answered `303` to `/account`, and `/account` answered `200` showing the user;
    - `pnpm exec playwright install chromium` worked, without `--with-deps`: this machine is Arch-based, with the libraries already there, which CONTRIBUTING covers;
    - in the clone, `pnpm check` passed 338 files and 3,438 tests, `pnpm test:db` with the test database on 55432 passed 1,738 tests, and `pnpm test:browser` passed 70 tests;
    - then `down -v` and the clone was removed. `agentic-pg` and `agentic_dev` were untouched.

    Every step worked as written, so no doc needed fixing. Later changes from the docs review (28) changed CONTRIBUTING's test-database step from `export DATABASE_URL=…` to the same value given on the command line. That's equivalent for `pnpm test:db`, and it avoids pointing a later `pnpm dev` at the test database.
28. **Phase C docs review** (independent `code-reviewer` pass): one Required fix, and all the optional ones and nits taken:
    - **Required:** the README said every reader setting syncs, but only theme, font, line spacing and column width do (`SETTINGS_KEYS` in `src/shared/sync/sync.ts`). Fixed to say what syncs;
    - the README now says which features need an account, and that page links need a Claude model, as the home page does;
    - the billing check matches `Pricing`, `prices` and `Subscription` in any case, while `Pro` stays case-sensitive;
    - links to a heading are checked, using GitHub's heading anchors;
    - the env drift test also finds `env['NAME']` reads;
    - CONTRIBUTING passes the test database's address on the command line, as above;
    - `.env.example` corrections: `PORT` is the port in the default `APP_ORIGIN`, not the dev server's port; `MAIL_FROM` is required with `MAIL_TRANSPORT`; and `SOURCE_URL` is also read by `pnpm build`;
    - the README says `SIGNUP=open` needs `SITE_CONTACT` in production only.
29. **The poller's unit names no server path for the token.** The acceptance check for paths in the diff flagged `/etc/folio-deploy/github_token`. The unit now uses `LoadCredential=github_token`, which systemd finds by name in its credential store, and the state file is described by `StateDirectory=` alone. The only server paths left are `/usr/local/bin/agentic-library-deploy` and `/opt/folio-deploy/` (accepted, Decision 10). The other addresses in the diff are reserved example domains (`example.org`, `example.com`).

30. **Final CI-parity run (Task 18)** on the final tree, each gate as CI runs it, all green:
    - `pnpm install --frozen-lockfile`, `pnpm exec biome ci .` and `pnpm typecheck`;
    - `pnpm test`: 3,449 tests;
    - `pnpm build`: writes `third-party-licenses.txt`, 196,911 bytes;
    - `pnpm audit`: no known vulnerabilities;
    - `pnpm test:browser`: 70 tests, and `pnpm test:db`: 1,738 tests;
    - the guard test (in `pnpm test`), and zizmor: no findings;
    - the Secrets scan with the job's arguments: the pushed range `origin/main..HEAD` with the base commit's allowlist (3 commits), and `--all` (93 commits), with no leaks.

    Coverage against the baseline:

    | | Statements | Branches | Functions | Lines |
    |---|---|---|---|---|
    | Unit | 92.26 | 89.79 | 91.25 | 93.35 (all equal to the baseline) |
    | Server | 96.18 | 93.43 | 94.87 | 97.04 (all above it) |

    No floor was changed.

## Needs owner action

**A. Left over from `instance-limits` (needed before launch):**
- [ ] Add `LIMIT_USER_AUDIO=1GB`, `LIMIT_AUDIOBOOK_SIZE=1GB` and `LIMIT_USER_PICTURES=100MB` to the dev and
      production env files, restart both, and check that the Storage section says "of 1 GB" and "of 100 MB"

**B. repo-security cut-over (spec Cut-over), in this order, after reviewing the commits:**
- [ ] Push `main`. CI now runs on GitHub-hosted runners, and the `dev` deployment request waits for the poller
- [ ] Create the fine-grained token for this repo only, with Actions: read, Contents: read, Deployments: read and
      write, and Metadata: read. Store it root-only in systemd's credential store (for example `/etc/credstore/`) as
      `github_token`, which the unit's `LoadCredential=github_token` finds by name. Set an expiry reminder
- [ ] Create the `folio-deploy` user, give it the runner user's sudo rule for the deploy script, copy
      `scripts/deploy/*` to `/opt/folio-deploy/`, and install the units. Run `poll.ts --dry-run`, then enable the timer.
      Also:
      - install `/opt/folio-deploy` as `root:root`, mode `0755`;
      - with sudo 1.9.10 or newer, pin the rule's arguments:
        `folio-deploy ALL=(root) NOPASSWD: /usr/local/bin/agentic-library-deploy ^(dev|prod) [0-9a-f]{40}$`;
      - read the unit's hardening comment against what the deploy script writes (Build notes 15);
      - a dry run with the token, as the service would run it:
        `sudo systemd-run --pipe --wait -p User=folio-deploy -p LoadCredential=github_token -p StateDirectory=folio-deploy-poll /usr/bin/node /opt/folio-deploy/poll.ts --dry-run`
- [ ] Check that the waiting `dev` deployment goes to `success`. Then run
      `gh workflow run deploy-prod.yml -f sha=<that sha>` and check production. Production only accepts a commit that
      the poller itself deployed to dev, by its own record (Build notes 20), so dev always goes first. If either
      request is refused because of the environments' "main only" branch policy, adjust that policy, since the poller
      checks the branch itself
- [ ] Make a hand-made deployment request for a SHA that isn't on `main`, and check that it's marked `failure` and
      the journal shows the deploy script wasn't run
- [ ] Deregister `LINUX-LAPTOP`, remove the runner service and its sudo rule, and delete `CI_RUNNER`
- [ ] Run `node scripts/github/settings.ts --apply`, then `--check`. Only the "needs public" rows may differ
- [ ] The canary: push a throwaway branch with the canary key, check that Secrets scan fails, then delete the branch.
      Never merge it
- [ ] Check that three pushes to `main` in a row go green, and that Dependabot runs for both ecosystems

**C. legal-and-attribution, before launch:**
- [ ] Read Terms, Privacy and Copyright on dev. Optionally have a lawyer review them
- [ ] Make sure someone reads the `SITE_CONTACT` inbox
- [ ] Optional: register a DMCA designated agent, and add the name to the Copyright page's `notice` part

**D. contributor-docs:**
- [ ] If you want the Code of Conduct to show an address instead of the Privacy-page link, swap it in (plan Decision 13)

**E. Found during the build:**
- [ ] Push all three module commits together. From commit 1, Terms, Credits and the notices header say the code is
      MIT, and `LICENSE` only arrives in commit 3
- [ ] After 2026-11-27, remove `openai@7.62.0` from `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` (Build notes 16).
      Watch for a Dependabot security update that bumps to a version under 7 days old: the frozen install will
      refuse it until it's a week old, or until it's added to that list
- [ ] Check the onnxruntime licence link on Credits (`ENGINE_SOFTWARE` in `src/shared/read-aloud/folio-voices.ts`):
      `github.com/microsoft/onnxruntime` answered 404 from the build machine (Build notes 10)
- [ ] When `SOURCE_URL` is set, set it for `pnpm build` too, so `/third-party-licenses.txt` names the source

**F. Sign-off.** Claude fills these in when you say so.

Signed off (legal-and-attribution): ____ (date)

Signed off (repo-security): ____ (date)

Signed off (contributor-docs): ____ (date)

Signed off (go-public): ____ (date)
