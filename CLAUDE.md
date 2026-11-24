## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for orhunakkan/agentic-library, using the `gh` CLI. Read an issue with `gh issue view <n> --json title,body,labels,comments`: `--comments` prints nothing when an issue has none. Other operations: `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Tests

`pnpm test:db` (about 2–3 minutes for the full run, so set a longer command timeout) uses `DATABASE_URL`, or else local Postgres at `127.0.0.1:5432/agentic_test` (`tests/test-databases.ts`). E2e runs only in CI.

### Branches

One person works on this repo, so all work is committed on `main` and pushed straight to `origin main`, with no branches or pull requests. A commit closes its issue with `Closes #<n>`. After pushing, watch CI with `gh run watch`, because e2e runs only there.

### Coding standards

Reviewers apply `CODING_STANDARDS.md`.
