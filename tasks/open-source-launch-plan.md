# Implementation Plan: the rest of the open-source launch

Source specs (all approved 2026-11-25):
[SPEC-legal-and-attribution.md](../spec/SPEC-legal-and-attribution.md),
[SPEC-repo-security.md](../spec/SPEC-repo-security.md),
[SPEC-contributor-docs.md](../spec/SPEC-contributor-docs.md),
[SPEC-go-public.md](../spec/SPEC-go-public.md)

Status: written 2026-11-26. It has no open questions, because every gap is decided below. The owner adjusts the
decisions when reviewing the finished build.

Tasks: [tasks/open-source-launch-todo.md](open-source-launch-todo.md)

## Overview

This one plan replaces four per-module plans. On 2026-11-26 the owner chose a single plan for every module that's
left, with no open questions and Claude's recommendations taken throughout. It has two parts:

1. **The build (Tasks 0 to 18), in one session, in one go.** It writes all the code and docs for three modules, in
   this order: `legal-and-attribution`, then `repo-security`, then `contributor-docs`. It ends with three local commits
   on `main`, one per module, which aren't pushed. Anything only the owner can do goes in "Needs owner action".
2. **The launch (Tasks L1 to L12), in a later sitting, with the owner present.** This is `go-public`'s run-book. It
   can't be built in one go, because its spec makes every GitHub and server step ask-first, one at a time. It starts
   once the build is pushed, `repo-security`'s server cut-over is done, and every launch precondition holds.

## Facts checked while planning (2026-11-26)

### Tools and environment

| Thing | State |
|---|---|
| Node, pnpm | v26.13.1, pnpm 12.16.1 (`packageManager` `pnpm@12.16.1`) |
| Docker | installed and the daemon answers. Containers `agentic-pg` (`127.0.0.1:5432`) and `pw-server` are running |
| `gh` | logged in as `orhunakkan` |
| `git-filter-repo` | installed at `/usr/bin/git-filter-repo`, so go-public's ask-first install isn't needed |
| gitleaks, zizmor, actionlint | **not installed**. gitleaks and zizmor run through pinned Docker images, and actionlint isn't used |
| gitleaks image | `ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` (v8.30.1), from [publish-audit-report.md](../spec/publish-audit-report.md). Reused, so CI and the audit scan with the same build |
| `yaml` package | not a dependency yet. The spec approves adding it as a devDependency |

### Workflows today

- [ci.yml](../.github/workflows/ci.yml): jobs `checks` → `component` → `db` → `deploy-dev`, all on
  `runs-on: ${{ vars.CI_RUNNER }}`, each with the `if:` fork guard. Actions are `actions/checkout@v7`,
  `actions/setup-node@v7` and `pnpm/action-setup@v6`. Images are `mcr.microsoft.com/playwright:v1.64.1-noble` and
  `postgres:18`. The coverage-summary steps already pass `github.event.*` through `env:` (`CHANGE_RANGE`), not inline.
- [deploy-prod.yml](../.github/workflows/deploy-prod.yml): `workflow_dispatch` with input `sha`, guarded on
  `github.ref` and `github.actor`. It validates the SHA in shell and runs `sudo -n /usr/local/bin/agentic-library-deploy prod "$SHA"`.
- Both have top-level `permissions: contents: read`, and every job has `timeout-minutes`.

### Code that legal-and-attribution touches

- `parseSiteContact` is at [config.ts:194](../src/server/config.ts#L194), and the open-sign-up check is at
  [config.ts:273-275](../src/server/config.ts#L273-L275).
- `getNavData` is at [functions.ts:32](../src/server/functions.ts#L32). `EMPTY_NAV` is at
  [__root.tsx:32](../src/routes/__root.tsx#L32), and `NavData` is also derived in
  [AppSidebar.tsx:27](../src/client/components/AppSidebar.tsx#L27).
- `SITE_CREDIT`, `PRIVACY_UPDATED` and `TERMS_UPDATED` are in [site.ts](../src/shared/lib/site.ts).
- `AuditEvent` is at [audit.ts:4](../src/server/audit.ts#L4). It already has `book.imported`, `book.deleted` and others.
- Footer links use `data-testid="footer-link"` or `"home-footer-link"` and `data-key`
  ([SiteFooter.tsx](../src/client/components/SiteFooter.tsx), [HomeFooter.tsx](../src/client/features/home/HomeFooter.tsx)).
- There's no `copyright.tsx` route yet. `src/server/private-pages.test.ts` exists.

### Test configs

- Unit (`vitest.config.ts`): `src/**/*.test.{ts,tsx}`, `tests/**/*.test.ts`, `scripts/**/*.test.ts`. It excludes
  `**/node_modules/**`, db and browser tests.
- Database (`vitest.db.config.ts`): **only `src/server/**/*.test.ts`**. So a `scripts/db/books.db.test.ts`, as the
  spec names it, would never run (see Decision 6).
- Browser (`vitest.browser.config.ts`): `src/**/*.browser.test.tsx`.
- `.gitignore` ignores `node_modules/` everywhere, so fixture packages can't be committed under a `node_modules`
  folder (see Decision 7).

### Settings the server reads (for `.env.example`)

From `src/server`, `scripts/serve.ts` and `scripts/db`, outside tests: `ANTHROPIC_API_BASE APP_ORIGIN
ARTICLE_TEST_HOSTS AUDIO_BASE AUDIOBOOKS_DIR CONTENT_DIR COOKIE_SECURE CREDENTIALS_DIRECTORY DATABASE_URL DB_OWNER_ROLE
ELEVENLABS_API_BASE GITHUB_API_BASE GITHUB_RAW_BASE GITHUB_TOKEN HOST KEK KEK_PREVIOUS LIMIT_ARTICLES
LIMIT_ARTICLE_TEXT LIMIT_AUDIOBOOK_SIZE LIMIT_BOOKS LIMIT_USER_AUDIO LIMIT_USER_PICTURES MAIL_CAPTURE_DIR MAIL_FROM
MAIL_TRANSPORT NODE_ENV OPENAI_API_BASE OPEN_LIBRARY_BASE OPEN_LIBRARY_CONTACT OPEN_LIBRARY_COVERS_BASE PORT
RESEND_API_BASE RESEND_API_KEY RESEND_WEBHOOK_SECRET SIGNUP SITE_CONTACT USER USERNAME VOICES_DIR WIKIMEDIA_CONTACT
WIKIPEDIA_BASE WIKTIONARY_BASE`, plus `SOURCE_URL` once Task 1 lands. The spec's drift test excludes only `USER` and
`USERNAME`. `NODE_ENV` and `CREDENTIALS_DIRECTORY` aren't covered by it (see Decision 12).

## Architecture Decisions

These are the plan's own decisions, on top of the specs. Each one fills a gap or resolves a spec step that doesn't fit
the code. The build records any further ones in the todo's Build notes.

1. **One plan, two parts.** The build is one session in one go. The launch is a later sitting, because `go-public`
   makes every GitHub and server step ask-first, and its preconditions need the build to be pushed and live.
2. **Build order: legal-and-attribution → repo-security → contributor-docs.** The legal module is plain app code, and
   it needs nothing from the other two. `repo-security` must exist before `contributor-docs`, because the docs
   describe its CI, link `SECURITY.md`, and pin compose's Postgres to `ci.yml`'s digest. `contributor-docs` goes last,
   so its drift tests see `SOURCE_URL` and every other setting.
3. **Three commits, one per module, not one.** One commit across three modules would be too big to review. Each commit
   includes its module's Progress row ("built, awaiting sign-off"). A rename found under CODE_STANDARDS goes in its own
   `refactor:` commit just before the module's commit.
4. **The build doesn't push.** Pushing switches CI to GitHub-hosted runners, which spends private Actions minutes, and
   creates a `dev` deployment that waits until the poller is installed. So the push starts the owner's cut-over and
   is the owner's step. Before handing over, the build runs every CI gate locally (`biome ci`, typecheck, test, build,
   audit, test:browser, test:db), so that one push goes green.
5. **The CI images and actions are resolved during the build,** in Task 0, through `gh api` (tags dereferenced to
   commit SHAs) and `docker buildx imagetools inspect` (digests). Versions:
   - the current majors already in use (`checkout` v7, `setup-node` v7, `pnpm/action-setup` v6);
   - Playwright `v1.64.1-noble`, matching the installed `playwright` package;
   - `postgres:18`;
   - gitleaks v8.30.1, the publish-audit digest;
   - the latest zizmor release on `ghcr.io/zizmorcore/zizmor`.
6. **The operator book tool's logic lives in `src/server/operator-books.ts`,** tested by
   `src/server/operator-books.db.test.ts`. `scripts/db/books.ts` is a thin CLI over it. The db config only runs
   `src/server/**`, so a test under `scripts/db/` would never run, and the server coverage floors then cover the new
   code.
7. **Third-party-notices fixtures are built at test time** in a temporary directory: a `node_modules` tree with a plain
   package, a scoped one, one per licence-file name, and one with no licence. They aren't committed, because
   `node_modules/` is git-ignored. The plugin's package lookup takes the root as a parameter, so the tests can point it
   at the temporary tree.
8. **Licence texts are fetched verbatim from their source,** never written from memory:
   - GPL-3.0 from `https://www.gnu.org/licenses/gpl-3.0.txt`;
   - Contributor Covenant 2.1 from the official `code_of_conduct.md` at contributor-covenant.org (EthicalSource);
   - MIT is the SPDX text with the copyright line.
9. **The Secrets scan job uses `uses: docker://ghcr.io/gitleaks/gitleaks@sha256:…`**, not a `docker run` in shell. The
   guard test then checks its pin. The commit range comes in through `env:` (`github.event.before` or the PR's base
   SHA), and an all-zeros base scans every commit. zizmor's Workflow lint job runs the same way.
10. **Deploy poller details:**
    - **Install and run:** `scripts/deploy/*` is installed by hand under `/opt/folio-deploy/` and run with `node`.
      It's plain TypeScript, which Node 26 runs. The service runs as a dedicated `folio-deploy` user, which has the
      runner user's sudo rule, and the timer fires every 30 seconds.
    - **Token:** it comes in through systemd `LoadCredential=github_token:<root-only file>` and is read from
      `$CREDENTIALS_DIRECTORY`, the same way the app reads its secrets. It's never in a variable or an argument.
    - **Supersede:** for `production` as well as `dev`, only the newest waiting request is deployed, and older ones are
      marked `inactive`. "Newest" means the newest request, not the newest SHA, so a deliberate rollback still works.
    - **Already deployed:** a request for the SHA already live in that environment is marked `success` ("already
      deployed"), and the deploy script isn't run.
    - **One at a time:** a `flock` on a lock file stops overlapping runs.
    - **Statuses:** each one carries a fixed short reason chosen from an enum in `decide.ts`, never free text.
11. **`deploy-prod.yml` checks with `gh api` in its job,** using permissions `actions: read`, `contents: read` and
    `deployments: write`. The guard test's write allowlist is about writes only, so reads are allowed. The checks are:
    - the SHA is on `main`, through compare;
    - CI's `push` run for the SHA has succeeded;
    - a `dev` deployment of the SHA has a `success` status.
12. **`.env.example` lists `NODE_ENV`** (commented, `# NODE_ENV=production` in production) and leaves out
    `CREDENTIALS_DIRECTORY`. systemd sets the credentials directory, so the drift test excludes it with `USER` and
    `USERNAME`, and the Encryption group's comment explains it.
13. **The Code of Conduct contact is a link, not an address:** "the contact shown at
    https://agenticlibrary.app/privacy#questions". That's the hosted `SITE_CONTACT`, as the spec decided, but no email
    address enters a committed file, which is ask-first under contributor-docs. So the build doesn't need the owner's
    value. If the owner wants the address written out, they can swap it in when reviewing.
14. **Local Postgres in the build.** Port 5432 is taken by `agentic-pg`, so the fresh-clone walkthrough uses
    `FOLIO_DB_PORT=55432`, the documented fallback. It runs as compose project `folio-walkthrough`, which is removed with
    `down -v` at the end. The owner's `agentic-pg` is never touched.
15. **The canary is split by what's allowed:**
    - **The build does the local half:** a canary key, committed in a scratch clone, must be refused by the pre-commit
      hook, and the Secrets scan job's command, run locally, must fail on it.
    - **The CI half is owner action:** pushing a canary branch is ask-first.
16. **`settings.ts --check` runs read-only against the current repo during the build,** and its diff is recorded.
    `--apply` is never run by the build, because it's ask-first.
17. **`scripts/github/settings.ts` keeps the desired state as typed data** in `scripts/github/desired.ts`, beside the
    two ruleset JSON files. The diff is a pure function over recorded `gh api` responses, kept in
    `scripts/github/fixtures/`, so it's unit tested with no network.
18. **Legal text is the spec's text.** Where a spec table gives the meaning but not the words, the build writes short,
    plain sentences in the style of today's pages, and says nothing the code doesn't make true.

## Task List

### Part 1: the build (one session, in one go)

#### Phase 0
- [ ] Task 0: Preflight. Tools, a clean tree, green baselines, and the pinned SHAs and digests resolved

#### Phase A: legal-and-attribution
- [ ] Task 1: `parseHttpsUrl`, `SOURCE_URL`, and `sourceUrl` in the nav data
- [ ] Task 2: Footers: the new credit line, Copyright, Credits and Source code links
- [ ] Task 3: Terms rewrite, and the new `/copyright` page
- [ ] Task 4: Privacy rewrite
- [ ] Task 5: The operator book tool (`find`, `remove`), with its audit events
- [ ] Task 6: Third-party notices at build time, and the Credits "Software" part
- [ ] Checkpoint A, then commit 1 (`feat:`)

#### Phase B: repo-security
- [ ] Task 7: The workflow guard test and its fixtures, red against today's workflows
- [ ] Task 8: `ci.yml` and `deploy-prod.yml` on GitHub-hosted runners, pinned, with Secrets scan and Workflow lint
- [ ] Task 9: The deploy poller: `decide.ts` (tested), `poll.ts --dry-run`, and the systemd units
- [ ] Task 10: gitleaks in pre-commit, Dependabot, and `minimumReleaseAge`
- [ ] Task 11: GitHub settings as code (`settings.ts --check/--apply`) and the two rulesets
- [ ] Task 12: `SECURITY.md`
- [ ] Checkpoint B, then commit 2 (`ci:`)

#### Phase C: contributor-docs
- [ ] Task 13: `LICENSE` and `package.json` licence
- [ ] Task 14: `compose.yaml`, `db/local/`, `.env.example`, and the env drift test
- [ ] Task 15: `README.md`, `CONTRIBUTING.md`, the docs drift test, and the CLAUDE.md line
- [ ] Task 16: `CODE_OF_CONDUCT.md`, the issue forms and the PR template
- [ ] Task 17: The fresh-clone walkthrough
- [ ] Checkpoint C, then commit 3 (`docs:`)

#### Phase D
- [ ] Task 18: Full CI-parity run, final review, and the hand-over

### Part 2: the launch (later sitting, owner present, each step approved on its own)

- [ ] Tasks L1 to L12: `go-public`'s run-book, steps 1 to 12, with its preconditions checked first

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A pinned action or image SHA is mistyped | High: CI fails on the first push | Resolved by command, not typed. The guard test checks the shape, and `docker buildx imagetools inspect` checks each digest exists |
| The workflow changes can't be run locally | Med | zizmor and the guard test run locally. The `docker://` gitleaks step is run as the same `docker run`. The first push is the real test, and it's owner action |
| Private Actions minutes | Med | The build doesn't push. After the push, CI takes about 20 minutes a run until the repo is public |
| Legal text claims something the code doesn't do | High | Component tests pin each part. Every data fact is checked against the code and listed in Build notes. A lawyer review is suggested in owner action |
| Third-party notices miss a package, or fail on one with no licence | Med | The build fails instead of skipping it. Unit tests cover `?url` ids and scoped packages. Any new override needs a reason and a vendored text, and is recorded in Build notes |
| A coverage floor misses | Med | New server code (`operator-books.ts`) gets db tests. If a floor misses with every test green on `email/store.ts` or `actions.ts`, it's the known flake: re-run before debugging |
| The walkthrough touches the owner's Postgres | High | It uses its own compose project and port 55432, and the cleanup is `down -v` on that project only |
| The poller can be fooled into deploying an unvalidated SHA | High | The decision is a pure function, with a test per refusal. A status reason comes from a fixed enum. `--dry-run` comes first on the server. The installed copy is only updated by hand |
| The deploy script can't handle the new, unrelated history at launch | High | It's a launch precondition: the owner reads the script. Step 7 proves it while the repo is still private |

## Open Questions

None. Every gap is decided above or in the todo, as the owner asked.
