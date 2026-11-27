# CLAUDE.md

This is the Folio web app, built with TanStack Start, React 19, Postgres, Vitest and Biome, and managed with pnpm.

## Code standards

Follow every rule in [CODE_STANDARDS.md](CODE_STANDARDS.md) in all code you write or change. The rules carry equal weight, and new ones are added there, not here:

@CODE_STANDARDS.md

## Commands

```
pnpm dev                Dev server
pnpm check              Lint, typecheck and unit tests (run before calling a change done)
pnpm test:integration   Integration tests (*.integration.test.ts), against Postgres
pnpm test:browser       Component tests (*.browser.test.tsx) in headless Chromium
pnpm lint:fix           Apply Biome fixes and formatting
docker compose up -d --wait   Local Postgres for dev and tests
```

The pre-commit hook in `.githooks/pre-commit` runs Biome on staged files, the typecheck, the repo checks in
`tests/repo/`, and the unit tests related to the staged `.ts` and `.tsx` files (`vitest related`, which needs no
Postgres or Chromium).

There's no CI, so these local gates are the only checks. Before a push, run `pnpm check`, `pnpm test:integration` and
`pnpm test:browser`.

Deploys run by hand on the server: `sudo /usr/local/bin/agentic-library-deploy dev [<sha>]` builds and deploys to dev
(origin/main by default), then `sudo /usr/local/bin/agentic-library-deploy prod <sha>` promotes the same release.

## Testing

Vitest is the only test tool. Playwright is installed only because Vitest's browser mode drives Chromium through it
(`@vitest/browser-playwright`, used by `pnpm test:browser`). Don't add Playwright tests, configs or scripts. The only
other users are the two hand-run fixture generators, `tests/fixtures/images/generate.ts` and
`tests/fixtures/imports/generate.ts`, which use its Chromium to draw images and print PDFs.

Every test, and every helper that only tests use, lives in `tests/`, never in `src/` or `scripts/`. A test sits at its
module's path without `src/`, in the folder for its kind:

- `tests/unit/`: `*.test.ts` and `*.test.tsx` that need neither Postgres nor a browser. The test for
  `src/server/auth.ts` is `tests/unit/server/auth.test.ts`, and the one for `scripts/coverage/ratchet.ts` is
  `tests/unit/scripts/coverage/ratchet.test.ts`.
- `tests/integration/`: `*.integration.test.ts`, run against Postgres, as in
  `tests/integration/server/books/books.integration.test.ts`.
- `tests/component/`: `*.browser.test.tsx`, run in Chromium, as in
  `tests/component/client/features/ask/AskPanel.browser.test.tsx`.
- `tests/repo/`: checks on the repo as a whole, not on one module.
- `tests/support/` for helpers only tests import, `tests/fixtures/` for test data, and `tests/stubs/` for stand-ins
  for outside services.

Import app code as `~/…`, not by a relative path. Run Vitest through the `pnpm` scripts, or pass
`--config tests/vitest.config.ts` (or the integration or browser config). Without it, Vitest silently uses the app's
`vite.config.ts`. `tests/repo/test-layout.test.ts` enforces where tests live.

## Layout

- `src/routes/`: TanStack Start routes. `src/routeTree.gen.ts` is generated, so don't edit it.
- `src/client/`: browser code (components, features, lib, styles)
- `src/server/`: server-only code
- `src/shared/`: code used by both client and server
- `tests/`: every test, in `unit/`, `integration/`, `component/` and `repo/`, with the helpers only tests use
  (`support/`), test fixtures (`fixtures/`), stand-ins for outside services (`stubs/`) and the three Vitest configs
- `db/migrations/`: SQL migrations, applied with `pnpm db:migrate`
- `scripts/`: build, coverage, database and content tooling
