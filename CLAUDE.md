# CLAUDE.md

This is the Folio web app, built with TanStack Start, React 19, Postgres, Vitest, Playwright and Biome, and managed with pnpm.

## Code standards

Follow every rule in [CODE_STANDARDS.md](CODE_STANDARDS.md) in all code you write or change. The rules carry equal weight, and new ones are added there, not here:

@CODE_STANDARDS.md

## Commands

```
pnpm dev            Dev server
pnpm check          Lint, typecheck and unit tests (run before calling a change done)
pnpm test:db        Database tests (*.db.test.ts)
pnpm e2e:local      Playwright end-to-end tests on desktop, phone and tablet
pnpm lint:fix       Apply Biome fixes and formatting
```

The pre-commit hook in `.githooks/pre-commit` runs Biome on staged files, the typecheck, and the tests in `tests/`.

## Layout

- `src/routes/`: TanStack Start routes. `src/routeTree.gen.ts` is generated, so don't edit it.
- `src/client/`: browser code (components, features, lib, styles)
- `src/server/`: server-only code
- `src/shared/`: code used by both client and server
- `tests/`: repo-level tests and Playwright end-to-end tests (`tests/e2e/`). Unit tests sit next to their modules as `*.test.ts`.
- `db/migrations/`: SQL migrations, applied with `pnpm db:migrate`
- `scripts/`: build, coverage, database and content tooling
