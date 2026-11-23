## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for orhunakkan/agentic-library, using the `gh` CLI. Read an issue with `gh issue view <n> --json title,body,labels,comments`: `--comments` prints nothing when an issue has none. Other operations: `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Tests

`pnpm test:db` uses `DATABASE_URL`, or else local Postgres at `127.0.0.1:5432/agentic_test` (`tests/test-databases.ts`). E2e runs only in CI. Work goes straight to `main` with no PRs, so watch the push's run with `gh run watch`.

### Coding standards

Reviewers apply `CODING_STANDARDS.md`.
