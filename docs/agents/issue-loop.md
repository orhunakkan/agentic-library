# Issue loop

How `ready-for-agent` issues get built one at a time, each in a fresh Claude session, while no one is at the keyboard.

**Status:** built for option 1 (tmux on the owner's computer), see **How to start**. Not yet run end to end on a real issue.

## How to start

```bash
scripts/issue-loop.sh start          # start the loop in tmux and return; it keeps going on its own
scripts/issue-loop.sh start --once   # build one issue (plus its retro), then stop: use this first
scripts/issue-loop.sh status         # is it running, and the last lines of its log
scripts/issue-loop.sh stop           # finish the current issue, then stop
scripts/issue-loop.sh run --dry-run  # show the queue it would work through, start nothing
tmux attach -t issue-loop            # watch it live (detach again with Ctrl-b d)
```

"Start the issue loop" means running `scripts/issue-loop.sh start`.

Before it starts, it checks that you're on `main`, the working tree is clean, and local `main` hasn't diverged from `origin/main` (being ahead is fine: those commits go out with this cycle's push). It warns if Postgres isn't reachable for `pnpm test:db`. It runs under `systemd-inhibit`, so the machine won't idle or suspend. Closing the laptop lid can still suspend it.

The files:

| File | What it is |
|---|---|
| `scripts/issue-loop.sh` | The loop: picks issues, starts the sessions, checks the definition of done |
| `scripts/issue-loop/ci-local.sh` | The whole CI workflow run on this machine (`pnpm ci:local`): same jobs, same steps, same order, e2e in CI's container image. Its pass stands in for a green CI run |
| `scripts/ci/watch.ts` | `pnpm ci:watch [ref]`: finds the `ci.yml` run for a pushed commit (default HEAD), watches it, prints `<job>: <conclusion>` per job, then a last line `CI <success\|failure> for <short sha>: <run url>`. It exits 0 only if every job succeeded (the deploy job may be skipped), and non-zero if no run appears within 5 minutes. Its exit code is the verdict, so don't pipe it |
| `scripts/issue-loop/build-prompt.md` | Session A's extra instructions (the steps below), added to `/implement` |
| `scripts/issue-loop/retro-prompt.md` | Session B's extra instructions, added to `/retro` |
| `scripts/issue-loop/build-settings.json` | What Session A may run. Anything else is refused, never prompted |
| `scripts/issue-loop/retro-settings.json` | What Session B may run: read files and create issues, nothing else |

Logs for each run (the loop's log, plus each session's JSON output) are kept outside the repo, in `~/.local/state/issue-loop/agentic-library/runs/<time>/`. The full session transcripts are in `~/.claude/projects/-home-orhunakkan-agentic-library/<session id>.jsonl`.

Settings, as environment variables:

- `ISSUE_LOOP_SESSION_TIMEOUT`: how long one session may run before it's killed and counted as FAILED. Default `3h`.
- `ISSUE_LOOP_MAX_BUDGET_USD`: a spending cap per session. Default none.
- `CI_LOCAL_DATABASE_URL`: the Postgres `pnpm ci:local` tests against, standing in for CI's `postgres:18` service. Default `postgres://postgres:postgres@127.0.0.1:5432/agentic_test`. `pnpm ci:local` also needs Docker, to run the e2e job in CI's Playwright image.

How it picks the next issue: the lowest-numbered open `ready-for-agent` issue that has **no assignee** and no open blocker (a native GitHub dependency, or a `Blocked by: #n` line in its body). An assigned issue was either claimed by a session that didn't finish or taken by the owner, so the loop leaves it alone.

## The idea in one paragraph

A plain script (no AI) is the only thing that runs the whole time. It picks the oldest open `ready-for-agent` issue, starts a new Claude session to build it, waits for that session to exit, checks the result on GitHub, starts a second session to run a retro on the first, and then goes back for the next issue. Sessions never hand off to each other: everything the next one needs is in git, the issue tracker, or the repo's docs.

## The flow for one issue

Skills from the `mattpocock-skills` plugin are shown in brackets. `implement` and `retro` can't be invoked by the model mid-session, so each one is the prompt a session *starts* with. The other skills get called from inside the session.

```
┌──────────────────────────────────────────────────────────────┐
│ THE SCRIPT (no AI)                                           │
│                                                              │
│ 1. Ask GitHub for the oldest open "ready-for-agent" issue    │
│    none left? ──► STOP and print a summary                   │
│ 2. Start Session A for that issue, wait for it to exit       │
└──────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ SESSION A: BUILD (new session, starts with /implement #N)    │
│                                                              │
│  1. Read the issue                     [/implement]          │
│  2. Is it really ready?                                      │
│     no ──► comment, label "needs-info", print BLOCKED, exit  │
│  3. Assign it to the owner (claims it)                       │
│  4. Learn the area, if needed      [/domain-modeling]        │
│                                    [/codebase-design]        │
│  5. Build it test-first                [/tdd]                │
│     stuck on a failing test? ──►       [/diagnosing-bugs]    │
│  6. Run checks: pnpm check (+ pnpm test:db if server)        │
│  7. Review its own work                [/code-review]        │
│     fix what it finds, run the checks again                  │
│  8. Comment what's left undone, open "needs-triage"          │
│     issues for follow-ups                                    │
│  9. Run all of CI locally: pnpm ci:local                     │
│     red ──► one fix attempt            [/diagnosing-bugs]    │
│     still red ──► print FAILED, exit                         │
│ 10. Commit "... Closes #N" on main, no push  [/implement]    │
│ 11. Print DONE #N and exit                                   │
└──────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ THE SCRIPT                                                   │
│                                                              │
│ 3. Read Session A's last line, then check DONE itself        │
│    BLOCKED  ──► skip this issue, go to step 1 for the next   │
│    FAILED   ──► STOP, so the owner can look                  │
│    DONE     ──► note Session A's ID, start Session B         │
└──────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ SESSION B: RETRO (new session, starts with /retro)           │
│                                                              │
│  1. Read Session A's log               [/retro]              │
│  2. List what would make the next build go better:           │
│     missing checks, unclear standards, hard-to-find files    │
│                                 [/retro, /writing-for-agents]│
│  3. Open one "needs-triage" issue per idea (commits nothing) │
│  4. Exit                                                     │
└──────────────────────────────────────────────────────────────┘
                               │
                               ▼
                    back to THE SCRIPT, step 1
                    (#N is assigned, so it picks the next one)
                               │
                    queue empty, stop asked, --once, or FAILED
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ THE SCRIPT: END OF THE CYCLE                                 │
│                                                              │
│ 4. Push main, up to the last DONE commit, once               │
│    (the "Closes #N" lines close every issue built)           │
│ 5. Watch that one CI run: pnpm ci:watch <tip>                │
│    put its verdict (green/red) in the summary                │
└──────────────────────────────────────────────────────────────┘
```

Why BLOCKED skips but FAILED stops: a blocked issue means that issue's text is missing something. A failure may mean `main` or CI is broken, which would break every issue after it.

Why each issue is committed but not pushed: the tests run locally are the same tests, in the same order, in the same images as CI (`scripts/issue-loop/ci-local.sh` reads the Playwright image from `ci.yml`), so a local pass is enough to move on. Pushing each issue would start a CI run (and a dev deploy) per issue. Instead the script pushes once when the cycle ends, so CI runs once on the whole batch. The issues stay open on GitHub until that push; the loop doesn't pick them again because each one is assigned, and an issue blocked only by one of them counts as unblocked.

At the end of the cycle the script pushes only up to the last DONE commit, so anything a FAILED session committed stays local for the owner. If the push is rejected because `origin/main` moved, it stops without rebasing, since rebasing would change tested code: push by hand. If the machine dies mid-cycle, the commits stay on local `main`, and the next `start` pushes them with its own.

Why Session B only opens issues: `/retro` is written to propose and wait for a choice. With no one there to choose, it files its ideas for later triage. Letting it commit mechanical fixes (lint rules, checks) is a later step, once its proposals have earned trust.

## Definition of done

An issue is **DONE** only when all of these hold. The script checks 1, 3, 4 and 5 itself instead of trusting the session's `DONE` line. If any of those fail, the issue counts as FAILED.

| # | Condition | How it's checked |
|---|---|---|
| 1 | A new commit with `Closes #N` is on local `main` | `git log <base>..HEAD --grep "Closes #N"` |
| 2 | `pnpm check` passed (and `pnpm test:db` if server code changed) | The session reports it; #3 is the real proof |
| 3 | `pnpm ci:local` passed on that exact code, e2e included | `ci-local.sh` records each pass under the git tree it tested, in `~/.local/state/issue-loop/agentic-library/ci-local-passed/`; `ci-local.sh --passed HEAD` checks the commit's tree is one of them |
| 4 | Nothing was pushed by the session, and `origin/main` has nothing local `main` lacks | `git rev-list HEAD..origin/main` → empty; Session A may not push |
| 5 | No uncommitted changes or stray branches | `git status --porcelain` → empty |
| 6 | Leftovers are written down: undone parts as a comment on #N, follow-ups as `needs-triage` issues | The owner reviews these afterwards |

What DONE does *not* mean:

- Every part of the issue was built. A session may finish most of it and write up the rest (#6). That's deliberate: a partial result with a clear note beats a session that never ends.
- The retro succeeded. Session B runs after DONE, and its failure doesn't undo it.
- The issue is closed, or CI on GitHub is green. Both happen at the end of the cycle, after the push; the summary reports CI as green or red, from the exit code of `pnpm ci:watch`.

The other outcomes:

- **BLOCKED:** nothing committed. The issue stays open, labelled `needs-info`, with a comment saying what's missing.
- **FAILED:** anything else. The loop stops.

The **whole loop** is done when no open `ready-for-agent` issues are left, or when it stops on a failure, and in both cases once the push and its CI run are over.

## How one session hands off to the next

It doesn't. `claude -p "..."` runs one session to the end and then returns, like any shell command, and the script moves to its next line. What carries over:

| What | Where it's saved | Who reads it |
|---|---|---|
| The code | the commit on local `main` | the next session, which starts from a clean `main` |
| Whether the issue is done | the `Closes #N` commit on local `main` (and its assignee) | the script, when it picks the next issue |
| Did it work? | the session's last line: `DONE` / `BLOCKED` / `FAILED` | the script |
| Which session to retro | `session_id` from `claude -p ... --output-format json` | the script, which passes it to Session B |
| What's left undone | issue comments and new `needs-triage` issues | the owner |

Sketch of the handoff:

```bash
out=$(claude -p "/mattpocock-skills:implement #92 ..." --output-format json)   # Session A runs, then exits
id=$(echo "$out" | jq -r .session_id)                                          # remember which session it was
echo "$out" | jq -r .result | grep -q "DONE #92" || exit 1                     # stop if it didn't work
claude -p "/mattpocock-skills:retro session $id ..."                           # Session B reads A's log
```

The plugin's `/handoff` skill isn't needed: each issue is self-contained, and starting with nothing from the previous issue is what keeps each session focused.

## Where it runs

The script starts every session itself. It only needs to be started once, somewhere that stays up.

1. **The owner's computer, left on.** Start it in `tmux`, detach, leave. The machine must not sleep. It works today, uses local Postgres for `pnpm test:db`, and is already logged in. It stops if the machine sleeps, goes offline or reboots. **Recommended first.**
2. **GitHub Actions.** Adding the `ready-for-agent` label (from anywhere, including the GitHub app) triggers a job that runs one session for that issue, or a nightly job works through the queue. It runs on GitHub's machines, with Postgres from a service container. It needs a Claude token as a repo secret (`claude setup-token`) and permission to push to `main` and close issues. **Recommended once option 1 has proven itself.**
3. **Claude Code cloud routines** (`/schedule`). They run on a schedule in the cloud with nothing to maintain. Check first that the environment can run `pnpm test:db`.

Whichever option is used, a headless session can't answer permission prompts. The sessions run with `--permission-mode dontAsk` and the allowlists in `scripts/issue-loop/*-settings.json`: anything not listed is refused, not prompted. Any push or pull, `git reset --hard`, branch switching, closing issues by hand and `gh pr` are explicitly denied. Claude Code still lets harmless read-only commands (like `whoami`) through without a rule.
