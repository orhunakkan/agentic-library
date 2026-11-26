# Contributing to Folio

Thanks for helping. This guide gets you from a clone to a passing test suite, and says how a pull request is tested
and merged.

## Before you start

- **Small fixes**, such as a typo, a broken link or a clear bug, can go straight to a pull request.
- **For a larger change**, open an issue first, so the approach can be agreed before you spend time on it.
- **Security problems** go through [SECURITY.md](SECURITY.md), never into a public issue.
- **Copyright notices** about a book on agenticlibrary.app go to the site’s
  [Copyright page](https://agenticlibrary.app/copyright), not to an issue.
- **The [Code of Conduct](CODE_OF_CONDUCT.md)** covers this repository’s issues, pull requests and other GitHub spaces.
  Using agenticlibrary.app is covered by its [Terms](https://agenticlibrary.app/terms).

## Setup

1. Follow the [quick start in the README](README.md#quick-start). It installs the dependencies, starts Postgres with
   both local databases, and makes your first account.
2. Install the browser that the component tests run in:

   ```sh
   pnpm exec playwright install --with-deps chromium
   ```

   `--with-deps` installs the system libraries Chromium needs, which may ask for your password. Leave it out if they’re
   already there.
3. Optionally, turn on the pre-commit hook. It scans the staged changes for secrets, then runs Biome, the typecheck and
   the tests in `tests/`:

   ```sh
   git config core.hooksPath .githooks
   ```

**If port 5432 is already taken**, for example by a Postgres you already run, start the local one on another port:

```sh
FOLIO_DB_PORT=55432 docker compose up -d --wait
```

Then change the port in `DATABASE_URL` in your `.env` to `55432`. The database tests default to port 5432, so give
them the test database’s address on the same line:

```sh
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/agentic_test pnpm test:db
```

Don’t `export` it: `pnpm dev` would then use `agentic_test`, which the database tests wipe, because a variable already
set wins over `.env`.

Compose is optional: your own Postgres 18 with an `agentic_dev` and an `agentic_test` database works too.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | The dev server, at http://localhost:3000 |
| `pnpm check` | Lint, typecheck and unit tests. Run it before you push |
| `pnpm test:browser` | Component tests, in headless Chromium |
| `pnpm test:db` | Database tests, against `agentic_test` |
| `pnpm lint:fix` | Apply Biome’s fixes and formatting |
| `pnpm db:migrate` | Apply the migrations in `db/migrations/` |
| `docker compose down -v` | Stop the local Postgres and delete both databases, to start again from nothing |

## Code standards

Follow [CODE_STANDARDS.md](CODE_STANDARDS.md). In short:

- descriptive names: a one-letter name only next to where it’s used, or for the few meanings the file lists;
- no `any`: use a specific type, or `unknown` narrowed before use;
- comments are `/** … */` blocks, never `//` or `/* */`, apart from tool directives. `tests/comments.test.ts`
  enforces this.

Coding agents read [AGENTS.md](AGENTS.md), which points them to the same rules.

## Tests

Vitest runs all three kinds of test, and there’s no other test tool:

- **Unit tests** sit next to their module, as `*.test.ts`. `pnpm check` runs them.
- **Database tests** are `*.db.test.ts`, run by `pnpm test:db`. They drop and re-create the test database’s schema.
- **Component tests** are `*.browser.test.tsx`, run by `pnpm test:browser` in headless Chromium.

Coverage floors only go up (`pnpm coverage:ratchet`). Run `pnpm check` before you push, and also `pnpm test:db` when
your change touches the server, or `pnpm test:browser` when it touches the UI.

## Migrations

Add a new file, `db/migrations/NNNN_description.sql`, numbered after the last one. Never edit or delete a migration
that has been applied: `pnpm db:migrate` refuses one whose checksum has changed. To drop a column, stop using it in
one release, then drop it in a later one.

## Commits and pull requests

- One change per pull request.
- The pull request’s title uses [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
  `docs:`, `refactor:`, `test:`, `chore:`, `ci:`, `style:`), because it becomes the squash commit’s message.
- Update the docs and `.env.example` in the same pull request as the change they describe.
- Never put API keys, real user data or a book’s text in code, fixtures, issues or logs.

## How your pull request is tested and merged

- Every pull request, from a fork or not, runs the full suite on GitHub-hosted runners, with no secrets and a read-only
  token.
- A first-time contributor’s run waits until the maintainer approves it.
- The required checks are the five jobs in [ci.yml](.github/workflows/ci.yml): Lint, types, unit tests, build, audit;
  Component tests; Database tests; Secrets scan; and Workflow lint. See
  [SPEC-repo-security.md](spec/SPEC-repo-security.md) for why.
- Only the maintainer merges, as a squash.
- Dependabot’s pull requests follow the same path.

## AI-assisted pull requests

They’re welcome, and you don’t need to say a tool helped. Whoever opens the pull request must have read and run every
change in it, and must be able to answer review questions about it. Coding agents get their instructions from
[AGENTS.md](AGENTS.md).

## Licence of contributions

A contribution is made under the project’s [MIT licence](LICENSE). There’s no contributor licence agreement and no
sign-off line.
