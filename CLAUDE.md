## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for orhunakkan/agentic-library, using the `gh` CLI. Read an issue with `gh issue view <n> --json title,body,labels,comments`: `--comments` prints nothing when an issue has none. Other operations: `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Tests

`pnpm check` runs lint, types and the unit suite (client, shared, `tests/`). `pnpm test:db` runs only `src/server` tests (about 2–3 minutes, so set a longer command timeout) against `DATABASE_URL`, or else local Postgres at `127.0.0.1:5432/agentic_test` (`tests/test-databases.ts`). `pnpm ci:local` runs the whole CI workflow on this machine, e2e included, in CI's container image (about 10 minutes; needs Docker and that Postgres). Otherwise e2e runs only in CI.

### Branches

One person works on this repo, so all work is committed on `main` and pushed straight to `origin main`, with no branches or pull requests. A commit closes its issue with `Closes #<n>`. Before pushing, comment on the issue with any part of it left undone and why, and open a `needs-triage` issue for each follow-up the review found. After pushing, run `pnpm ci:watch` and use its exit code, because e2e runs only there. Don't pipe it: the exit code and the per-job lines are the verdict.

### Coding standards

Reviewers apply `CODING_STANDARDS.md`.
