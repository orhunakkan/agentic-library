You are running inside the issue loop (`docs/agents/issue-loop.md`), unattended. No one can answer a question or a permission prompt, so never ask: decide, or stop with BLOCKED or FAILED. A tool call that is denied stays denied, so find another way or stop.

Your task is issue #{{ISSUE}}. `/implement` drives the work; around it, follow these steps in order.

1. **Read the issue**, with its comments: `gh issue view {{ISSUE}} --json title,body,labels,comments`. State its title.
2. **Check that it is ready.** If it can't be built without guessing (missing acceptance criteria, contradictions, a decision only the owner can make), comment on it saying exactly what's missing, run `gh issue edit {{ISSUE}} --remove-label ready-for-agent --add-label needs-info`, make no commits, leave the working tree clean, and finish with `BLOCKED #{{ISSUE}}: <reason>`.
3. **Claim it**: `gh issue edit {{ISSUE}} --add-assignee @me`.
4. **Learn the area.** Read `GLOSSARY.md` and the ADRs in `docs/adr/` that touch it. Use the `domain-modeling` and `codebase-design` skills when choosing terms or seams.
5. **Build it test-first** with the `tdd` skill. When a failure's cause isn't clear after one look, use the `diagnosing-bugs` skill instead of guessing.
6. **Run the checks**: `pnpm check`, plus `pnpm test:db` (it takes 2–3 minutes, so set a long timeout) if anything under `src/server` changed. Everything must pass.
7. **Review**: run the `code-review` skill with commit `{{BASE_SHA}}` as the fixed point. Fix the findings that cite a rule or the issue, then rerun the checks. Run the review once; don't loop it until it comes back clean.
8. **Write up what's left.** Comment on #{{ISSUE}} about any part not done and why. Open a `needs-triage` issue for each follow-up the review found (`gh issue create --label needs-triage ...`).
9. **Commit and push.** Commit on `main` with a message containing `Closes #{{ISSUE}}`, then `git push origin main`. If the push is rejected because `main` moved, run `git pull --rebase origin main`, rerun the checks, and push again.
10. **Watch CI** for your commit: `gh run list --workflow ci.yml --commit <sha> --json databaseId -q '.[0].databaseId'` (it can take a minute to appear), then `gh run watch <id> --exit-status`. If it's red, make one fix attempt with the `diagnosing-bugs` skill, push, and watch again. If it's still red, finish with `FAILED #{{ISSUE}}: <reason>`.
11. **Finish** with `DONE #{{ISSUE}}`.

Rules:

- Your final message must end with exactly one of these lines, with nothing after it: `DONE #{{ISSUE}}`, `BLOCKED #{{ISSUE}}: <reason>` or `FAILED #{{ISSUE}}: <reason>`.
- Never force push, rewrite pushed history, switch branches, close an issue by hand, or touch any other `ready-for-agent` issue.
- On FAILED, leave the working tree as it is, so the owner can inspect it.
