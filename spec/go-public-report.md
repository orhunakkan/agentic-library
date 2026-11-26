# go-public report — V1

Spec: [SPEC-go-public.md](SPEC-go-public.md). Run on 2026-11-26. This report holds no secret value and not the owner's
personal address.

**Result: `orhunakkan/agentic-library` is public.** Its history holds only no-reply addresses, the settings match, and
dev and production run the new `main`. Partway through, the owner changed the plan: CI, the deploy poller and
Dependabot version updates were removed, and deploys run by hand on the server (see step 7).

## 1. Final audit — 2026-11-26

- Ran: the publish audit re-run at `7c31cf4d` (106 commits). See "Re-run before go-public" in
  [publish-audit-report.md](publish-audit-report.md).
- Result: pass. 0 findings in history, tracked files and all blobs, and 3 of 3 canaries caught.

## 2. Back up and freeze — 2026-11-26

- Committed the audit section as `01178cef`, the last commit on the old history: 107 commits.
- Bundle `~/backups/agentic-library-pre-public.bundle`: `git bundle verify` passed, complete history, `refs/heads/main`.
- Result: pass.

## 3. Rewrite — 2026-11-26

- Ran: `git filter-repo --mailmap` in a `--no-local` scratch clone, with one mailmap line.
- Trees, commit count (107 and 107) and the one merge are identical. The only emails left are the no-reply address
  (213 fields) and `noreply@github.com` (1). The personal address and its domain are in 0 objects and 0 files.
- `cmp` of names, dates, messages and trailers found **one difference**: filter-repo rewrote the short SHA `c6daf30e` in
  one commit message to its new SHA, `5a6c2f23`. It's the same commit (same tree, date and subject). This was accepted,
  because the old SHA would point nowhere in the new history.
- Result: pass, with that difference accepted.

## 4. Retire the old deploy path — 2026-11-26

- The poller was never started, so there was nothing to stop.
- Deleted the deploy key from the old repo, turned its Actions off, and renamed it to `agentic-library-archive`.
- Result: pass (private, Actions off, no deploy key).

## 5. Create the new repo, private — 2026-11-26

- Ran: `gh repo create orhunakkan/agentic-library --private`, with the About text, homepage and 7 topics. Added the
  deploy key back read-only, then ran `settings.ts --apply`.
- `settings.ts --check`: differed only in the five rows that need a public repo.
- Pushed `main` at `a7ad50fa` (107 commits). `git ls-remote` showed `HEAD` and `refs/heads/main` only.
- Result: pass.

## 6. Switch the local clone — 2026-11-26

- Ran: `git reset --hard origin/main`, then `git reflog expire --expire=now --all` and `git gc --prune=now`.
- The local history holds only the no-reply address and `noreply@github.com`.
- Result: pass. The freeze ended.

## 7. Verify while private, and the change of plan — 2026-11-26

- CI on the new repo failed with `startup_failure` three times, with no job started. The new repo was the first to get
  the selected-actions and SHA-pinning policy. The exact cause was never read, because GitHub only shows it on the web
  page.
- The owner decided to remove CI. `b1e6b7e` removes both workflows, the workflow guard test, `ci:watch`, the deploy
  poller and `.github/dependabot.yml`. The settings now want Actions off and no deployment environments, and the
  `main-changes` ruleset keeps the squash PR rule without required status checks. Actions was turned off, the `dev` and
  `production` environments were deleted, and the two Dependabot PRs were closed. On the server, the poller's units,
  files, sudo rule and user were removed. No server token was ever created.
- Also on the server: the old runner `LINUX-LAPTOP` was deregistered and its service and sudo rule removed, and
  `CI_RUNNER` was deleted. The hosted limits (`LIMIT_USER_AUDIO=1GB`, `LIMIT_AUDIOBOOK_SIZE=1GB`,
  `LIMIT_USER_PICTURES=100MB`) were set on both sites. `.github/dependabot.yml` was fixed (`287afa4`) before it was
  removed.
- Local gates on `b1e6b7e`: `pnpm check` (3,404 tests), `pnpm test:db` (1,738) and `pnpm test:browser` (70) passed.
- Deployed by hand: `agentic-library-deploy dev b1e6b7e…`, then `prod b1e6b7e…`. Both passed their smoke and live
  checks, and `/healthz` answers 200 on both public URLs.
- Result: pass, on the changed plan.

## 8. Make it public — 2026-11-26

- Ran: `gh repo edit --visibility public`, then `settings.ts --apply` and `--check`. `--check` reports **no differences**.
- The rules API for `main` shows `pull_request`, `deletion` and `non_fast_forward`. There are no required status checks,
  because there's no CI. The licence API reports `MIT`.
- A fresh `--mirror` clone of the public repo has `refs/heads/main` (109 commits) and the closed Dependabot PRs'
  `refs/pull/1/head` and `refs/pull/2/head`. gitleaks found 0 leaks over every ref, the only emails are no-reply
  addresses, and the personal address and its domain are in 0 objects.
- Result: pass.

## 9. Point the sites at the source — 2026-11-26

- Set `SOURCE_URL=https://github.com/orhunakkan/agentic-library` on both services (`source.conf`) and restarted them.
  The Source code link in `HomeFooter` and `SiteFooter` opens the repo on both sites.
- The server's deploy script now passes `SOURCE_URL` to `pnpm build`, so the next build's
  `/third-party-licenses.txt` names the source. A backup of the old script is next to it.
- Community profile: 100%. The issue chooser asks a signed-out visitor to sign in, as GitHub always does.
- Result: pass.

## 10. Close the archive — 2026-11-26

- Ran: `gh repo archive orhunakkan/agentic-library-archive`. It's private and archived. The new repo's `--check` still
  reports no differences. There's no old server token to revoke, because none was ever created.
- Result: pass.

## 11. Open sign-up

`SIGNUP=open` was already set on both sites before this launch. It wasn't changed, and the rehearsal wasn't run.

## Left open

- The Credits link for onnxruntime-web (`github.com/microsoft/onnxruntime`) answers 404, and so does GitHub's API for
  that repo. The npm package still names it as its source.
- Dev still loads the old Paddle credentials and a `test_api_token` that no code reads.
- After 2026-11-27, `openai@7.62.0` can come out of `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`.
- Step 12, the 7-day watch, is the owner's.
