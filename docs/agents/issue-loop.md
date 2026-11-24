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

Before it starts, it checks that you're on `main`, the working tree is clean, and local `main` matches `origin/main`. It warns if Postgres isn't reachable for `pnpm test:db`. It runs under `systemd-inhibit`, so the machine won't idle or suspend. Closing the laptop lid can still suspend it.

The files:

| File | What it is |
|---|---|
| `scripts/issue-loop.sh` | The loop: picks issues, starts the sessions, checks the definition of done |
| `scripts/issue-loop/build-prompt.md` | Session A's extra instructions (the steps below), added to `/implement` |
| `scripts/issue-loop/retro-prompt.md` | Session B's extra instructions, added to `/retro` |
| `scripts/issue-loop/build-settings.json` | What Session A may run. Anything else is refused, never prompted |
| `scripts/issue-loop/retro-settings.json` | What Session B may run: read files and create issues, nothing else |

Logs for each run (the loop's log, plus each session's JSON output) are kept outside the repo, in `~/.local/state/issue-loop/agentic-library/runs/<time>/`. The full session transcripts are in `~/.claude/projects/-home-orhunakkan-agentic-library/<session id>.jsonl`.

Settings, as environment variables:

- `ISSUE_LOOP_SESSION_TIMEOUT`: how long one session may run before it's killed and counted as FAILED. Default `3h`.
- `ISSUE_LOOP_MAX_BUDGET_USD`: a spending cap per session. Default none.

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
│  6. Run all checks: pnpm check (+ pnpm test:db if server)    │
│  7. Review its own work                [/code-review]        │
│     fix what it finds, run the checks again                  │
│  8. Comment what's left undone, open "needs-triage"          │
│     issues for follow-ups                                    │
│  9. Commit "... Closes #N" and push to main  [/implement]    │
│ 10. Watch CI (gh run watch)                                  │
│     red ──► one fix attempt            [/diagnosing-bugs]    │
│     still red ──► print FAILED, exit                         │
│ 11. Print DONE #N and exit                                   │
└──────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ THE SCRIPT                                                   │
│                                                              │
│ 3. Read Session A's last line, then check DONE on GitHub     │
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
                    (#N is closed, so it picks the next one)
```

Why BLOCKED skips but FAILED stops: a blocked issue means that issue's text is missing something. A failure may mean `main` or CI is broken, which would break every issue after it.

Why Session B only opens issues: `/retro` is written to propose and wait for a choice. With no one there to choose, it files its ideas for later triage. Letting it commit mechanical fixes (lint rules, checks) is a later step, once its proposals have earned trust.

## Definition of done

An issue is **DONE** only when all of these hold. The script checks 1, 3, 4 and 5 itself instead of trusting the session's `DONE` line. If any of those fail, the issue counts as FAILED.

| # | Condition | How it's checked |
|---|---|---|
| 1 | A commit with `Closes #N` is on `origin/main` | `git fetch && git log origin/main --grep "Closes #N"` |
| 2 | `pnpm check` passed (and `pnpm test:db` if server code changed) | The session reports it; #3 is the real proof |
| 3 | CI is green for that exact commit, e2e included | `gh run list --commit <sha>` → `success` |
| 4 | The issue is closed | `gh issue view N --json state` → `CLOSED` |
| 5 | No uncommitted changes or stray branches | `git status --porcelain` → empty |
| 6 | Leftovers are written down: undone parts as a comment on #N, follow-ups as `needs-triage` issues | The owner reviews these afterwards |

What DONE does *not* mean:

- Every part of the issue was built. A session may finish most of it and write up the rest (#6). That's deliberate: a partial result with a clear note beats a session that never ends.
- The retro succeeded. Session B runs after DONE, and its failure doesn't undo it.

The other outcomes:

- **BLOCKED:** nothing committed. The issue stays open, labelled `needs-info`, with a comment saying what's missing.
- **FAILED:** anything else. The loop stops.

The **whole loop** is done when no open `ready-for-agent` issues are left, or when it stops on a failure.

## How one session hands off to the next

It doesn't. `claude -p "..."` runs one session to the end and then returns, like any shell command, and the script moves to its next line. What carries over:

| What | Where it's saved | Who reads it |
|---|---|---|
| The code | the commit on `main` | the next session, which starts from a clean `main` |
| Whether the issue is done | the issue state (closed by `Closes #N`) | the script, when it picks the next issue |
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

Whichever option is used, a headless session can't answer permission prompts. The sessions run with `--permission-mode dontAsk` and the allowlists in `scripts/issue-loop/*-settings.json`: anything not listed is refused, not prompted. Force pushes, `git reset --hard`, branch switching, closing issues by hand and `gh pr` are explicitly denied. Claude Code still lets harmless read-only commands (like `whoami`) through without a rule.
