You are running inside the issue loop (`docs/agents/issue-loop.md`), unattended. No one can answer a question or a permission prompt, so never ask: decide, or stop with BLOCKED or FAILED. A tool call that is denied stays denied, so find another way or stop.

Your task is issue #{{ISSUE}}. `/implement` drives the work; around it, follow these steps in order.

1. **Read the issue**, with its comments: `gh issue view {{ISSUE}} --json title,body,labels,comments`. State its title.
2. **Check that it is ready.** If it can't be built without guessing (missing acceptance criteria, contradictions, a decision only the owner can make), comment on it saying exactly what's missing, run `gh issue edit {{ISSUE}} --remove-label ready-for-agent --add-label needs-info`, make no commits, leave the working tree clean, and finish with `BLOCKED #{{ISSUE}}: <reason>`.
3. **Claim it**: `gh issue edit {{ISSUE}} --add-assignee @me`.
4. **Learn the area.** Read `GLOSSARY.md` and the ADRs in `docs/adr/` that touch it. Use the `domain-modeling` and `codebase-design` skills when choosing terms or seams.
5. **Build it test-first** with the `tdd` skill. When a failure's cause isn't clear after one look, use the `diagnosing-bugs` skill instead of guessing.
6. **Run the checks** while you work: `pnpm check`, plus `pnpm test:db` (it takes 2–3 minutes, so set a long timeout) if anything under `src/server` changed. Everything must pass.
7. **Review**: run the `code-review` skill with commit `{{BASE_SHA}}` as the fixed point. Fix the findings that cite a rule or the issue, then rerun the checks from step 6. Run the review once; don't loop it until it comes back clean.
8. **Write up what's left.** Comment on #{{ISSUE}} about any part not done and why. Open a `needs-triage` issue for each follow-up the review found. For each body, write it to a file in the scratchpad with the Write tool, then pass that file: `gh issue comment {{ISSUE}} --body-file <path>`, `gh issue create --label needs-triage --title "<title>" --body-file <path>`. Never use a heredoc or an inline `--body`: both are refused here.
9. **Run CI locally**: `pnpm ci:local`, as the last thing before committing, with a timeout of at least 30 minutes (the run is about 10). It runs every CI job and step in CI's container images, so a pass here replaces waiting for CI. If it fails, make one fix attempt with the `diagnosing-bugs` skill and run it again. If it's still red, finish with `FAILED #{{ISSUE}}: <reason>`. Change no files after it passes: the loop checks that what you commit is the exact code that passed.
10. **Commit, don't push.** Commit on `main` with a message containing `Closes #{{ISSUE}}`. Don't push and don't watch CI: the loop pushes every issue of the cycle at once when the cycle ends, so CI runs once, and watches it with `pnpm ci:watch`. The issue stays open until then; that's expected. This overrides the push and CI steps in `CLAUDE.md`.
11. **Finish** with `DONE #{{ISSUE}}`.

Rules:

- Your final message must end with exactly one of these lines, with nothing after it: `DONE #{{ISSUE}}`, `BLOCKED #{{ISSUE}}: <reason>` or `FAILED #{{ISSUE}}: <reason>`.
- Never push, rewrite history, switch branches, close an issue by hand, or touch any other `ready-for-agent` issue.
- On FAILED, leave the working tree as it is, so the owner can inspect it.
