# Spec: contributor-docs — V1

Status: approved (2026-11-25)

Module of [capability-map.md](capability-map.md). It depends on `billing-removal`, `instance-limits` and `repo-security`,
and it takes the self-hosting notes that `legal-and-attribution` hands it. The docs describe the repo as those modules
leave it: no billing, `LIMIT_*` settings, `SOURCE_URL`, GitHub-hosted CI and `SECURITY.md`. `go-public` depends on this
module.

## Objective

Give someone who has never seen the repo what they need to understand Folio, run it, change it and send a PR, and make
the licence clear:

1. **`LICENSE`** (MIT), and `"license": "MIT"` in `package.json`.
2. **`README.md`**: what Folio is, a quick start, configuration, limits, running it in production from source, running
   it for other people, and the licence.
3. **`CONTRIBUTING.md`**: setup, the commands, the code standards, how tests and migrations work, commit and PR rules,
   how a fork PR is tested and merged, and AI-assisted PRs.
4. **`CODE_OF_CONDUCT.md`**: Contributor Covenant 2.1.
5. **Issue forms and a PR template** in `.github/`.
6. **`.env.example`**: every setting the server reads, ready for local development once it is copied to `.env`.
7. **`compose.yaml`**: a local Postgres 18 with the `agentic_dev` and `agentic_test` databases the code already
   expects.
8. **Two tests** that fail when these docs drift from the code.

**Who it's for:**

- **New contributors**, who should get from `git clone` to a green `pnpm check` and a running dev server by following
  the docs, without asking anyone.
- **Self-hosters**, who need to know which settings matter, which values agenticlibrary.app uses, and what they must
  rewrite before they run Folio for other people.
- **Readers of agenticlibrary.app** who arrive from the footer's Source code link, and who need one paragraph that says
  what Folio is.
- **The owner, as the only maintainer**, who gets fewer setup questions, issues that come with the facts needed to act
  on them, and PRs that say how they were tested.

**What success looks like:** on a clean machine with Node 26, pnpm and Docker, the README quick start, followed word
for word, gives a running Folio at `http://localhost:3000` with an admin account signed in. CONTRIBUTING, followed the
same way, gives a passing `pnpm check`, `pnpm test:db` and `pnpm test:browser`. The docs never mention plans, prices or
Paddle. A setting added to the server without a line in `.env.example`, or a doc that names a missing `pnpm` script
or links to a missing file, fails `pnpm check`.

## What the repo has today

- **No `README`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `LICENSE`, `.env.example` or compose file.** `.github/` holds only
  `workflows/`. `SECURITY.md` arrives with `repo-security`.
- **`package.json`** says `"license": "AGPL-3.0-only"` and `"private": true`. `engines.node` is `>=26`, and
  `packageManager` is `pnpm@12.16.1`.
- **Agent docs:** [AGENTS.md](../AGENTS.md) points to [CLAUDE.md](../CLAUDE.md), which imports
  [CODE_STANDARDS.md](../CODE_STANDARDS.md). These stay. CONTRIBUTING links them and doesn't repeat them.
- **Settings** are parsed in [config.ts](../src/server/config.ts). [serve.ts](../scripts/serve.ts) reads `HOST` and
  `PORT`, [repository.ts](../src/server/repository.ts) reads `CONTENT_DIR` and `AUDIO_BASE`, and
  [migrate.ts](../scripts/db/migrate.ts) reads `DB_OWNER_ROLE`. In production, secrets can come from systemd
  credentials in `CREDENTIALS_DIRECTORY` (`kek`, `kek_previous`, `resend_api_key`, `resend_webhook_secret`,
  `github_token`) instead of variables. The server refuses to start, naming the setting, on a bad value. In production
  it needs `DATABASE_URL`, `KEK` and `APP_ORIGIN`.
- **No server-wide AI key.** Readers save their own Anthropic, OpenAI or ElevenLabs keys in the app, and the keys are
  encrypted with `KEK`. Without `KEK`, Folio runs, but no key can be saved.
- **Sign-up** defaults to `SIGNUP=invite`. The first account is made with
  `pnpm db:users create <name> --role admin`, which prints a generated password once. `MAIL_TRANSPORT=capture` writes
  mail to `.mail/` and only runs on localhost.
- **Databases:**
  - [test-databases.ts](../tests/test-databases.ts) defaults the db tests to
    `postgres://postgres:postgres@127.0.0.1:5432/agentic_test`. The db tests need that database to exist, and they drop
    and re-create its `public` schema.
  - The owner's local dev database is `agentic_dev` on the same server.
  - CI uses a `postgres:18` service with `POSTGRES_PASSWORD=postgres` and `POSTGRES_DB=agentic_test`.
- **Browsers:** Vitest is the only test tool. The component tests (`pnpm test:browser`) run in headless Chromium,
  which Vitest drives through Playwright (`@vitest/browser-playwright`). The Playwright end-to-end suite was removed on
  2026-11-26.
- **Pre-commit hook:** [.githooks/pre-commit](../.githooks/pre-commit) runs only after
  `git config core.hooksPath .githooks`. No script turns it on.
- **Commits** follow Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `style:`).
  `repo-security` makes `main` accept squash merges only, so a PR's title becomes its commit message.

## What changes

### 1. Licence

- **`LICENSE`**: the standard MIT text, unchanged, with the line `Copyright (c) 2026 Orhun Akkan`. Nothing else goes in
  the file, so GitHub detects it as MIT. The GPL-3.0 note goes in the README (section 2).
- **`package.json`**: `"license": "MIT"`. `"private": true` stays, because Folio isn't published to npm.

### 2. `README.md`

In this order. Each section is short and links to the file that holds the detail instead of copying it:

| Section | Content |
|---|---|
| Title and intro | "Folio", then the home page's line (`HERO_LINE` in [Hero.tsx](../src/client/features/home/Hero.tsx)), then: free to use at agenticlibrary.app, and open source under MIT. |
| What Folio does | 6 to 10 bullets, taken from the home page's feature sections so the README never claims more than the site does. One bullet says that AI features use the reader's own API key. |
| Quick start | The local-dev steps in the box below. |
| Configuration | `.env.example` is the reference. A table of the three settings that production needs (`DATABASE_URL`, `KEK`, `APP_ORIGIN`). Systemd credentials are named as the way to keep secrets out of the environment. |
| Limits | The six `LIMIT_*` settings from [SPEC-instance-limits.md](SPEC-instance-limits.md): what each limits, its default and agenticlibrary.app's value. Also the format (`1GB`, binary units, a bare number refused for a size), and that the account page's Storage section shows the limits in effect. |
| Running in production | From source, since there's no production container in V1: Node 26, `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm db:migrate`, `pnpm voices:fetch`, then `NODE_ENV=production pnpm start` behind a reverse proxy that terminates TLS. `HOST` and `PORT`, and `DB_OWNER_ROLE` for migrations run as a separate owner role. It doesn't describe agenticlibrary.app's own server or deploy. |
| Running Folio for other people | From [SPEC-legal-and-attribution.md](SPEC-legal-and-attribution.md): rewrite `terms.tsx`, `privacy.tsx`, `copyright.tsx` and the © line in `HomeFooter.tsx` for your own service. Set `SITE_CONTACT` and `SOURCE_URL`. `SIGNUP=open` needs mail and `SITE_CONTACT`. `/third-party-licenses.txt` lists the licences of the code sent to browsers. |
| Contributing | One paragraph linking `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` and `SECURITY.md`. |
| Licence | MIT, with a link to `LICENSE`. Then one paragraph: the Folio voice worker includes espeak-ng and piper-phonemize, which are GPL-3.0. Their source is offered on Credits and in `/third-party-licenses.txt`, and Folio's own code stays MIT. |

The quick start, which is also the setup in CONTRIBUTING:

```
git clone https://github.com/orhunakkan/agentic-library.git folio && cd folio
pnpm install
docker compose up -d --wait                 # Postgres on 127.0.0.1:5432
cp .env.example .env
openssl rand -base64 32                     # paste the output after KEK= in .env
pnpm db:migrate
pnpm db:users create <your-name> --role admin   # prints your password once
pnpm dev                                    # http://localhost:3000
```

The README's prerequisites line states Node 26 or newer, the pnpm major in `packageManager`, and Docker with Compose,
or your own Postgres 18. It doesn't say how to install pnpm, because Node 26 doesn't bundle Corepack. It links pnpm's
installation page instead.

### 3. `CONTRIBUTING.md`

| Section | Content |
|---|---|
| Before you start | Small fixes go straight to a PR. For a larger change, open an issue first so the approach can be agreed. Report security problems through `SECURITY.md`, never in a public issue. Send copyright notices to `/copyright`, not to an issue. |
| Setup | The quick start (linked, not copied), then: `pnpm exec playwright install --with-deps chromium` (the browser the component tests run in) and, optionally, `git config core.hooksPath .githooks` to turn on the pre-commit hook. What to do if port 5432 is taken (section 7). |
| Commands | `pnpm dev`, `check`, `test:browser`, `test:db`, `lint:fix`, `db:migrate`, with one line each, plus `docker compose down -v` to reset the local databases. |
| Code standards | Follow [CODE_STANDARDS.md](../CODE_STANDARDS.md), with one line per rule (names, no `any`, `/** */` comments) and a note that `tests/comments.test.ts` enforces the comments rule. Agents read [AGENTS.md](../AGENTS.md). |
| Tests | Unit tests sit next to their module as `*.test.ts`. Database tests are `*.db.test.ts`, and component tests are `*.browser.test.tsx`. Vitest runs all three; there is no other test tool. Coverage floors only go up (`pnpm coverage:ratchet`). Run `pnpm check` before you push, and `pnpm test:db` or `pnpm test:browser` when your change touches the server or the UI. |
| Migrations | Add a new `db/migrations/NNNN_description.sql`. Never edit or delete an applied migration, because `db:migrate` refuses a changed checksum. To drop a column, stop using it first, then drop it in a later release. |
| Commits and PRs | One change per PR. The PR title uses Conventional Commits, because it becomes the squash commit. Update docs and `.env.example` in the same PR as the change they describe. Never put API keys, real user data or book text in code, fixtures, issues or logs. |
| How your PR is tested and merged | Every PR, fork or not, runs the full suite on GitHub-hosted runners, with no secrets and a read-only token. A first-time contributor's run waits for the owner to approve it. The required checks are the five listed in [SPEC-repo-security.md](SPEC-repo-security.md). Only the owner merges, as a squash. Dependabot PRs follow the same path. |
| AI-assisted PRs | Welcome, with no disclosure needed. Whoever opens the PR must have read and run every change and must answer review questions about it. Agents get their instructions from `AGENTS.md`. |
| Licence of contributions | A contribution is under the project's MIT licence. There's no CLA and no DCO. |

### 4. `CODE_OF_CONDUCT.md`

- **Contributor Covenant 2.1**, word for word, including the enforcement guidelines and the attribution section.
- **The contact** for reports is agenticlibrary.app's `SITE_CONTACT` value, the same address the Privacy and Copyright
  pages show. The owner gives the value when this file is written. It isn't recorded in this spec.
- It covers the repository's issues, PRs and other GitHub spaces. It doesn't cover use of agenticlibrary.app, which
  the Terms cover.

### 5. Issue forms and PR template

`.github/ISSUE_TEMPLATE/config.yml`:

- `blank_issues_enabled: false`.
- Contact links:
  - **Report a security vulnerability**, linking to the repo's `security/advisories/new`.
  - **Copyright notice about an uploaded book**, linking to `https://agenticlibrary.app/copyright`.
  - **Help with an agenticlibrary.app account**, linking to `https://agenticlibrary.app/privacy`, which shows the site
    contact, so readers don't post their username in public.

`.github/ISSUE_TEMPLATE/bug_report.yml`, an issue form with the label `bug`:

- What happened, and what you expected. Both required.
- Steps to reproduce. Required.
- Where: a dropdown with agenticlibrary.app, self-hosted, or local development.
- Browser and device.
- Version: a commit SHA, or the date for agenticlibrary.app.
- A required checkbox: "I've removed API keys, passwords, personal details and book text."

`.github/ISSUE_TEMPLATE/feature_request.yml`, with the label `enhancement`: the problem, the proposed change, and the
alternatives considered.

`.github/pull_request_template.md`:

- What changes and why, with a link to the issue if there is one.
- How it was tested.
- Checklist:
  - [ ] `pnpm check` passes
  - [ ] tests added or updated
  - [ ] `pnpm test:db` or `pnpm test:browser` run if the server or UI changed
  - [ ] docs and `.env.example` updated if behaviour or settings changed
  - [ ] migrations only added, never edited
  - [ ] no secrets or personal data
  - [ ] the title uses Conventional Commits

### 6. `.env.example`

- **It lists every setting read in `src/server/` (outside tests), `scripts/serve.ts` and `scripts/db/`**, grouped under
  `#` headings: Server, Database, Encryption, Sign-up and mail, Site, Limits, Storage, Outside services, and Only for
  tests.
- **Uncommented lines are local-development values**, so copying the file to `.env` gives a working setup.
  Commented lines are optional settings, shown with their default.
- **Each setting gets a one-line comment:** what it does, its default, and agenticlibrary.app's value where that
  differs. For the `LIMIT_*` settings and `SOURCE_URL`, that's what `instance-limits` and `legal-and-attribution` hand
  over.
- **Secrets are always empty:** `KEK`, `KEK_PREVIOUS`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` and `GITHUB_TOKEN`.
  Their comments say how to generate the value, and which systemd credential can supply it in production.
- **The "Only for tests" group** holds the `*_BASE` overrides that point outside services at local stubs, along with
  `ARTICLE_TEST_HOSTS`, `AUDIO_BASE` and `MAIL_CAPTURE_DIR`. They are commented out, and the heading says operators
  don't need them.

The format:

```sh
# Database
# Local Postgres from compose.yaml. In production, your own server, with a password that isn't "postgres".
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/agentic_dev
# Role that owns the tables, if migrations connect as a different role. Default: the connecting role.
# DB_OWNER_ROLE=

# Encryption
# Encrypts readers' saved API keys. Required in production. Generate with: openssl rand -base64 32
# In production you can use the systemd credential "kek" instead.
KEK=

# Limits (see README, Limits). Defaults shown; agenticlibrary.app uses 1GB.
# LIMIT_USER_AUDIO=8GB
```

The local values are `APP_ORIGIN=http://localhost:3000`, `COOKIE_SECURE=false`, `MAIL_TRANSPORT=capture`,
`MAIL_FROM=Folio <folio@example.com>` and `SIGNUP=invite`. `.env` stays git-ignored.

### 7. `compose.yaml`

```yaml
name: folio
services:
  postgres:
    image: postgres:18@sha256:<same digest as ci.yml> # 18.x
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: agentic_dev
    ports:
      - "127.0.0.1:${FOLIO_DB_PORT:-5432}:5432"
    volumes:
      - folio-postgres:/var/lib/postgresql
      - ./db/local:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d agentic_dev"]
      interval: 2s
      timeout: 5s
      retries: 15
volumes:
  folio-postgres:
```

- `db/local/create-test-database.sql` runs once, when the volume is first created, and creates `agentic_test`.
  `db:migrate` only reads `db/migrations/`, so `db/local/` doesn't affect it.
- **The port is bound to `127.0.0.1` only,** so the well-known password is never reachable from the network.
- **The image is pinned by the same digest as the `postgres` service in [ci.yml](../.github/workflows/ci.yml),** so
  local runs and CI use the same Postgres, and it's bumped together with CI by hand.
- **If 5432 is taken,** set `FOLIO_DB_PORT=55432`. Then change the port in `.env`, and export
  `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/agentic_test` before `pnpm test:db`.
  CONTRIBUTING says this.
- Compose is optional. Your own Postgres 18 with the same two databases works too.

### 8. Drift tests

Both are in `tests/`, so they run in `pnpm check`, in CI and in the pre-commit hook.

`tests/env-example.test.ts`:

- The settings listed in `.env.example`, commented or not, are exactly the settings read in the source files of section 6. A
  setting read but not listed fails, naming it, and so does a setting listed but never read. `USER` and `USERNAME`
  are excluded by name. They're operating-system variables that `scripts/db/users.ts` writes to the audit log, not
  settings.
- The secrets in section 6 have empty values.
- No line holds a value shaped like a real key (`re_…`, `github_pat_…`, `whsec_…`, `sk-…`).

`tests/docs.test.ts`:

- Every relative link in `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` and
  `.github/pull_request_template.md` points to a file that exists.
- Every `pnpm <name>` in those files' code is a `package.json` script, or one of `install`, `exec` and `dlx`.
- `package.json` says `"license": "MIT"`, and `LICENSE` starts with `MIT License` and has the copyright line.
- `compose.yaml` pins `postgres` by the same `@sha256:` digest as `ci.yml` and binds its port to `127.0.0.1`.
- None of those files mentions `Paddle`, `Pro`, `pricing` or `subscription`, so no billing text leaks back in.

### 9. `CLAUDE.md`

The Commands block gains `docker compose up -d --wait   Local Postgres for dev and tests`. Nothing else changes.

## Cut-over

1. **Before building:** `billing-removal`, `instance-limits`, `legal-and-attribution` and `repo-security` are merged,
   so the docs describe code that exists. The owner gives the `SITE_CONTACT` value for the Code of Conduct.
2. **Code:** merge sections 1 to 9 in one PR, or in a few, but always in this order: licence; then compose and
   `.env.example` with their test; then README and CONTRIBUTING with the docs test; then the Code of Conduct and the
   templates.
3. **Check:** follow the fresh-clone walkthrough (see Testing strategy) and fix anything in the docs that didn't work
   word for word.
4. **`go-public`** checks that the issue chooser shows the two forms and three links, and that Insights → Community
   standards is complete.

## Commands

```
pnpm check                                    Includes tests/docs.test.ts and tests/env-example.test.ts
pnpm exec vitest run tests/docs.test.ts tests/env-example.test.ts
docker compose up -d --wait                   Start local Postgres; waits for the health check
docker compose exec postgres psql -U postgres -l   Should list agentic_dev and agentic_test
docker compose down -v                        Stop it and delete both databases
FOLIO_DB_PORT=55432 docker compose up -d --wait   If 5432 is taken
```

## Files

```
LICENSE                                    MIT, new
package.json                               license: MIT
README.md                                  new
CONTRIBUTING.md                            new
CODE_OF_CONDUCT.md                         Contributor Covenant 2.1, new
.env.example                               new
compose.yaml                               local Postgres 18, new
db/local/create-test-database.sql          creates agentic_test on first start, new
.github/ISSUE_TEMPLATE/config.yml          no blank issues, three contact links
.github/ISSUE_TEMPLATE/bug_report.yml      issue form
.github/ISSUE_TEMPLATE/feature_request.yml issue form
.github/pull_request_template.md           new
CLAUDE.md                                  one line in Commands
tests/env-example.test.ts                  new
tests/docs.test.ts                         new
```

## Code style

Follow [CODE_STANDARDS.md](../CODE_STANDARDS.md): descriptive names, `/** */` comments, and no `any`. Parsed YAML and
`package.json` start as `unknown` and are narrowed. YAML is parsed with the `yaml` package that `repo-security` adds.

```ts
import { globSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

/** Where the server and its operator scripts read settings. Tests, stubs and CI read others, which don't belong here. */
const SETTING_SOURCES = ['src/server/**/*.ts', 'scripts/serve.ts', 'scripts/db/*.ts']
const READ = /\benv\.([A-Z][A-Z0-9_]*)\b/g
const LISTED = /^#?\s*([A-Z][A-Z0-9_]*)=/gm
/** Operating-system variables the users script writes to the audit log. They aren't settings. */
const NOT_SETTINGS = new Set(['USER', 'USERNAME'])

function settingsReadByCode(): Set<string> {
  const sources = SETTING_SOURCES.flatMap((pattern) => globSync(pattern)).filter((file) => !file.endsWith('.test.ts'))
  const names = sources.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(READ)].map(([, name]) => name))
  return new Set(names.filter((name) => !NOT_SETTINGS.has(name)))
}

it('lists every setting the server reads, and nothing else', () => {
  const listed = new Set([...readFileSync('.env.example', 'utf8').matchAll(LISTED)].map(([, name]) => name))
  const read = settingsReadByCode()
  expect([...read].filter((name) => !listed.has(name)), 'read by the server but missing from .env.example').toEqual([])
  expect([...listed].filter((name) => !read.has(name)), 'in .env.example but read nowhere').toEqual([])
})
```

## Testing strategy

- **Drift tests** (Vitest, in `tests/`): each check in section 8 has a failing case built from an in-memory string. For
  example, a `.env.example` missing a setting, a README linking `docs/missing.md`, or a compose file with an unpinned
  image. The real files must pass.
- **Fresh-clone walkthrough** (manual, the acceptance test): in a new clone, in a directory with no `.env` and no
  existing compose volume, follow the README quick start word for word, then CONTRIBUTING's setup. Record every step
  that didn't work as written, fix the doc, and repeat until none fail. It's run once by the owner or an agent, on
  Linux.
- **Compose:** `docker compose up -d --wait`, then `pnpm test:db` with no `DATABASE_URL` set, passes against it.
- **Templates:** checked on GitHub by `go-public`, because the issue chooser only renders on the public repo.
- No coverage floors change. The tests only read files, and they're outside the coverage `include` globs.

## Boundaries

- **Always:**
  - link to the file that holds a detail instead of copying it;
  - take facts from the code and the other module specs, not from memory;
  - keep every secret in `.env.example` empty;
  - bind the local Postgres to `127.0.0.1`.
- **Ask first:**
  - putting any email address in a committed file;
  - adding a dependency (the `yaml` package from `repo-security` is enough);
  - changing a workflow;
  - turning the pre-commit hook on automatically.
- **Never:**
  - describe agenticlibrary.app's server, its paths or its deploy beyond what `publish-audit` accepted as public;
  - put real credentials, user data or the owner's `.env` values in any file;
  - promise a reply time for issues or PRs (`SECURITY.md` keeps its own 7-day aim);
  - mention plans, prices or Paddle.

## Success criteria

- [ ] `LICENSE` is the standard MIT text with `Copyright (c) 2026 Orhun Akkan`, and `package.json` says `MIT`. GitHub's
      licence API reports `mit` once the repo is public (checked by `go-public`).
- [ ] The fresh-clone walkthrough ends with an admin signed in at `http://localhost:3000`. `pnpm check`, `pnpm test:db`
      and `pnpm test:browser` pass, with every step taken from the README or CONTRIBUTING as written.
- [ ] `docker compose up -d --wait` starts Postgres 18 on `127.0.0.1:5432` with `agentic_dev` and `agentic_test`, using
      the same image digest as `ci.yml`. Nothing listens on another interface.
- [ ] `tests/env-example.test.ts` passes. Removing any setting from `.env.example`, or adding one that the code doesn't
      read, makes it fail and name the setting.
- [ ] `tests/docs.test.ts` passes. A broken link, an unknown `pnpm` script, an unpinned compose image or the word
      `Paddle` in a doc makes it fail.
- [ ] The README covers every section in section 2, including the six limits with hosted values and the GPL-3.0 note
      for the voice worker.
- [ ] CONTRIBUTING covers every section in section 3, including how fork PRs are tested and the AI-assisted PR rule.
- [ ] `CODE_OF_CONDUCT.md` is Contributor Covenant 2.1 with the hosted `SITE_CONTACT` as the contact.
- [ ] The issue chooser on the public repo shows the bug and feature forms and the three contact links, with no blank
      issue option (checked by `go-public`).
- [ ] Insights → Community standards on the public repo is complete (checked by `go-public`).
- [ ] `pnpm check` passes.

## Risks

- **Docs drift.** Settings, scripts and links change. Mitigation: the two drift tests, and the PR checklist line. Prose,
  such as what a section says a feature does, can still drift, and only review catches that.
- **Port 5432 is often taken** by a Postgres already installed on the machine, as on the owner's. Mitigation:
  `FOLIO_DB_PORT` and a CONTRIBUTING note. The default stays 5432, because the test code's default URL uses it.
- **The quick start is only walked through on Linux.** macOS and Windows (WSL) contributors may hit differences, such as
  `openssl` missing on Windows. Mitigation: the README names `openssl rand -base64 32` and says any 32 random bytes in
  base64 work. Reports from contributors fix the rest.
- **A large first clone.** The clone includes the full history and the fixtures. This is accepted.
- **Contributor Covenant asks for enforcement capacity** that one maintainer may not have. This is accepted: the text
  says the maintainer acts on reports, and nothing more.

## Out of scope (deferred)

- Screenshots, a demo GIF and README badges: add them once the public repo and its CI exist.
- A docs website, and translated docs: the README and CONTRIBUTING are enough for V1.
- A dev container or Codespaces config: compose covers the database, and the rest is Node.
- A production `Dockerfile` or one-click deploy: already deferred in the map.
- GitHub Discussions: off until there's demand.
- A changelog and tagged releases: `main` is the only supported version.
- A seed script with sample books: everyone starts with an empty library in V1.
- Turning the pre-commit hook on automatically with a `prepare` script: it's slow, and CI is the gate.
- `.node-version` or `.nvmrc`: `engines.node` already states the version.

## Changes to other specs

Made in this session:

- **Capability map:** the Progress row for `contributor-docs` is marked approved, and `go-public` is next.

Inherited by later specs:

- **`go-public`:** check the issue chooser and Community standards, and check that GitHub detects the licence as MIT.

## Decisions

- **Code of Conduct reports go to the hosted `SITE_CONTACT`,** which is already public. There's no new mailbox, and no
  personal address is added to the repo. *(2026-11-25)*
- **Contributor Covenant 2.1.** *(2026-11-25)*
- **AI-assisted PRs are welcome with no disclosure.** Whoever opens the PR answers for every line. *(2026-11-25)*

## Assumptions (correct any of these)

1. Docs are in **English** only.
2. The pre-commit hook stays **opt-in**, and CONTRIBUTING says how to turn it on.
3. **No blank issues.** There are two forms and three contact links.
4. **Compose is optional.** Your own Postgres 18 is documented as an alternative.
5. The first account is made with **`pnpm db:users create`**, not through sign-up.
6. **`LICENSE` holds only the MIT text.** The GPL-3.0 note about the voice worker is in the README.
7. The quick start clones into **`folio/`**, although the repo is named `agentic-library`.
8. CLAUDE.md gains only the compose line. **AGENTS.md doesn't change.**

## Open questions

None.
