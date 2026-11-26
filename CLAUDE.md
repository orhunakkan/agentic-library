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

The pre-commit hook in `.githooks/pre-commit` runs Biome on staged files, the typecheck, the tests in `tests/`, and the
unit tests related to the staged `.ts` and `.tsx` files (`vitest related`, which needs no Postgres or Chromium).

There's no CI, so these local gates are the only checks. Before a push, run `pnpm check`, `pnpm test:integration` and
`pnpm test:browser`.

Deploys run by hand on the server: `sudo /usr/local/bin/agentic-library-deploy dev [<sha>]` builds and deploys to dev
(origin/main by default), then `sudo /usr/local/bin/agentic-library-deploy prod <sha>` promotes the same release.

## Testing

Vitest is the only test tool. Playwright is installed only because Vitest's browser mode drives Chromium through it
(`@vitest/browser-playwright`, used by `pnpm test:browser`). Don't add Playwright tests, configs or scripts. The only
other users are the two hand-run fixture generators, `tests/fixtures/images/generate.ts` and
`tests/fixtures/imports/generate.ts`, which use its Chromium to draw images and print PDFs.

## Layout

- `src/routes/`: TanStack Start routes. `src/routeTree.gen.ts` is generated, so don't edit it.
- `src/client/`: browser code (components, features, lib, styles)
- `src/server/`: server-only code
- `src/shared/`: code used by both client and server
- `tests/`: repo-level tests, test fixtures (`tests/fixtures/`) and stand-ins for outside services (`tests/stubs/`). Unit tests sit next to their modules as `*.test.ts`.
- `db/migrations/`: SQL migrations, applied with `pnpm db:migrate`
- `scripts/`: build, coverage, database and content tooling
