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
- [ ] Tree clean and in sync. All four gates pass, and the baseline is recorded
- [ ] Every pin in `$SCRATCH/pins.txt` is verified by a second command (`gh api …/commits/<sha>`, `docker buildx imagetools inspect <image>@<digest>`)

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
- [ ] `config.test.ts`: unset gives `null`, and a valid value is kept. `http://…`, a bare host, more than 200
      characters, and a value with spaces are each refused, naming `SOURCE_URL`. The existing `SITE_CONTACT` cases
      pass unchanged
- [ ] `NavData` carries `sourceUrl` in both places it's derived (`__root.tsx`, `AppSidebar.tsx`)

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
- [ ] New `*Footer.browser.test.tsx` for both footers. They check the credit line, the Copyright and Credits links,
      and the Source code link with and without `sourceUrl`
- [ ] No "public domain or shared" text left in `src` (the spec's leftover `git grep`)

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
- [ ] Browser tests for Terms and Copyright check every part by id, the `SITE_CONTACT` contact link, the six notice
      elements on Copyright, and none of "Pro", "Paddle", "price", "subscription" or "refund"
- [ ] `private-pages.test.ts` treats `/copyright` as public

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
- [ ] A Privacy browser test checks every part id, the contact link and the banned billing words
- [ ] Every fact the page states is listed in Build notes with the file that makes it true

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
- [ ] `operator-books.db.test.ts` covers:
  - [ ] a case-insensitive match on title and on author, across two accounts;
  - [ ] the `book.searched` row with its reason;
  - [ ] `removeBook` deleting the book, its pages and its pictures, recording `book.removed`, and returning the owner;
  - [ ] a missing reason refused;
  - [ ] a missing id changing nothing
- [ ] Wrong arguments make the CLI print usage and exit non-zero, and no `--reason` makes it refuse

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
- [ ] `third-party-notices.test.ts` runs on a temporary fixture tree and covers:
  - [ ] `?url` ids;
  - [ ] a scoped package root;
  - [ ] every licence-file name pattern;
  - [ ] a package with no licence throwing, naming the package;
  - [ ] an override supplying its text;
  - [ ] sorted output, the same on every run
- [ ] `pnpm build` writes `dist/client/third-party-licenses.txt`, which lists React, TanStack, the engine packages
      and the GPL-3.0 parts. Two builds give the same file (`cmp`)
- [ ] The file is served with the short cache (`headersFor`), and a Credits browser test checks the link

**Verification:** `pnpm check`, `pnpm build` twice, `pnpm test:browser`.

**Dependencies:** 0 · **Files:** the plugin and its test, `licence-overrides.ts`, `licences/GPL-3.0.txt`, `vite.config.ts`, `credits.tsx`, one browser test · **Scope:** M

## Checkpoint A: legal-and-attribution (self-check, then commit 1)

- [ ] `pnpm check`, `pnpm test:db`, `pnpm test:browser` and `pnpm build` pass, and no floor is below the baseline
- [ ] The spec's leftover `git grep` prints nothing, and `SOURCE_URL=http://example.org pnpm dev` refuses to start,
      naming `SOURCE_URL`
- [ ] The review (`code-review-and-quality`) has no required findings left
- [ ] The Progress row for `legal-and-attribution` says "built, awaiting sign-off"
- [ ] Commit 1: `feat: legal pages for a free service with open sign-up, a copyright page and third-party notices`

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
- [ ] Nine fixtures, and each fails with exactly its own rule's message
- [ ] Today's `ci.yml` and `deploy-prod.yml` fail it, which proves it catches the real problems

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
- [ ] `tests/workflows.test.ts` is green on the real workflows
- [ ] zizmor (the pinned image, run locally on `.github/workflows`) reports nothing, or each accepted finding is in
      `.github/zizmor.yml` with a reason
- [ ] The Secrets scan command, run locally with the job's arguments, passes on `main`'s history
- [ ] No `secrets.`, no `vars.CI_RUNNER`, and no `/usr/local/bin` left in the workflows

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
- [ ] `decide.test.ts` covers each refusal (a bad SHA, not on `main`, CI not green, production without a dev
      success), supersede for both environments, already deployed, and a valid deploy
- [ ] `poll.ts --dry-run` without a token exits with a clear message and changes nothing

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
- [ ] The canary is refused, the allowlisted fakes pass, and the skip line prints when `PATH` and Docker are both
      hidden
- [ ] `pnpm install --frozen-lockfile` still works with `minimumReleaseAge` set

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
- [ ] `settings.test.ts` covers matching, differing and missing settings, and unreadable or unexpected API shapes
- [ ] `--check` runs against the live repo and changes nothing. Its output is recorded

**Verification:** `pnpm exec vitest run scripts/github`, `pnpm check`.

**Dependencies:** 8 · **Files:** two rulesets, `desired.ts`, `settings.ts`, `settings.test.ts`, fixtures · **Scope:** M

## Task 12: `SECURITY.md`

**Description:** Write the six points of spec §7. Link private vulnerability reporting at
`https://github.com/orhunakkan/agentic-library/security/advisories/new`.

**Acceptance criteria:**
- [ ] Every point in §7 is present, and there's no email address

**Verification:** read it against §7.

**Dependencies:** None · **Files:** `SECURITY.md` · **Scope:** XS

## Checkpoint B: repo-security (self-check, then commit 2)

- [ ] `pnpm check` passes, with the guard, decide and settings tests in it. `pnpm test:db`, `pnpm test:browser` and
      `pnpm build` still pass
- [ ] zizmor is clean, and the pre-commit hook passes on this commit
- [ ] The review (`code-review-and-quality` and `security-and-hardening`) has no required findings left
- [ ] The Progress row for `repo-security` says "built, awaiting sign-off (needs the owner's cut-over)"
- [ ] Commit 2: `ci: move CI to GitHub-hosted runners and deploy through a server-side poller`

---

## Phase C: contributor-docs

## Task 13: Licence

**Description:** `LICENSE` holds the standard MIT text with `Copyright (c) 2026 Orhun Akkan` and nothing else.
`package.json` gets `"license": "MIT"`, and `"private": true` stays.

**Acceptance criteria:**
- [ ] The text matches SPDX MIT exactly, apart from the copyright line

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
- [ ] The test passes, and fails naming the setting when a line is removed or an unread setting is added
- [ ] `FOLIO_DB_PORT=55432 docker compose -p folio-walkthrough up -d --wait` starts Postgres on `127.0.0.1:55432`
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
- [ ] `docs.test.ts` passes. In-memory cases fail on a broken link, an unknown `pnpm` script, an unpinned or
      non-loopback compose file, and a banned word
- [ ] Every README and CONTRIBUTING section in §2 and §3 is present

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
- [ ] The Covenant text differs from the fetched source only in the contact placeholder
- [ ] The issue forms parse with `yaml`, and the docs test covers the PR template's links

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
- [ ] Every goal is reached, and every doc fix is listed in Build notes
- [ ] `agentic-pg` and the owner's `agentic_dev` are untouched

**Verification:** the walkthrough log in Build notes.

**Dependencies:** 13 to 16 · **Files:** doc fixes only · **Scope:** M

## Checkpoint C: contributor-docs (self-check, then commit 3)

- [ ] `pnpm check` passes, with both drift tests in it
- [ ] The review has no required findings left
- [ ] The Progress row for `contributor-docs` says "built, awaiting sign-off"
- [ ] Commit 3: `docs: add the MIT licence, README, contributing guide and local Postgres`

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
- [ ] Every gate is green, and no coverage floor is below the baseline
- [ ] `git log origin/main..main` shows the three module commits, plus any `refactor:` and the docs commit
- [ ] Nothing in the diff contains a token, key, env value, personal email, or server path other than
      `/usr/local/bin/agentic-library-deploy` and `/opt/folio-deploy/` (accepted, plan Decision 10)

**Verification:** the gate outputs in Build notes.

**Dependencies:** Checkpoint C · **Scope:** S

## Checkpoint: Build complete

- [ ] Every Part 1 box is ticked, Build notes are complete, and the owner's list is current

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

1. *(empty)*

## Needs owner action

**A. Left over from `instance-limits` (needed before launch):**
- [ ] Add `LIMIT_USER_AUDIO=1GB`, `LIMIT_AUDIOBOOK_SIZE=1GB` and `LIMIT_USER_PICTURES=100MB` to the dev and
      production env files, restart both, and check that the Storage section says "of 1 GB" and "of 100 MB"

**B. repo-security cut-over (spec Cut-over), in this order, after reviewing the commits:**
- [ ] Push `main`. CI now runs on GitHub-hosted runners, and the `dev` deployment request waits for the poller
- [ ] Create the fine-grained token for this repo only, with Actions: read, Contents: read, Deployments: read and
      write, and Metadata: read. Store it root-only, and set an expiry reminder
- [ ] Create the `folio-deploy` user, give it the runner user's sudo rule for the deploy script, copy
      `scripts/deploy/*` to `/opt/folio-deploy/`, and install the units. Run `poll.ts --dry-run`, then enable the timer
- [ ] Check that the waiting `dev` deployment goes to `success`. Then run
      `gh workflow run deploy-prod.yml -f sha=<that sha>` and check production
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

**E. Sign-off.** Claude fills these in when you say so.

Signed off (legal-and-attribution): ____ (date)

Signed off (repo-security): ____ (date)

Signed off (contributor-docs): ____ (date)

Signed off (go-public): ____ (date)
