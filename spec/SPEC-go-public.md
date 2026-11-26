# Spec: go-public — V1

Status: approved (2026-11-25)

Module of [capability-map.md](capability-map.md). Depends on every other module: `publish-audit`, `repo-security`,
`billing-removal`, `instance-limits`, `legal-and-attribution` and `contributor-docs`. Nothing depends on it. This
spec gathers the steps the other specs handed over (see [What the other specs hand over](#what-the-other-specs-hand-over)).

## Objective

Publish `main` as a new public repository `orhunakkan/agentic-library`, move dev and production deploys onto it, and
open sign-up on agenticlibrary.app. Nothing private may be published along the way, and deploys must keep working.

This module is a run-book, not a feature. It writes almost no code. Its work is an ordered set of steps on GitHub, on
the server and in the local clone, each with a check that has to pass before the next step starts.

**Who it's for:** the owner, who runs the launch. Claude runs the local and `gh` steps with the owner's approval
for each one. The owner runs the server steps, because Claude has no access to the server.

**What success looks like:** a stranger can find the repo, clone it, read MIT in the licence, open a PR that runs the
full suite, and sign up on agenticlibrary.app. The history holds no personal email address and no secret. The old
PRs, issues and run logs stay private in an archive. Dev and production run the new `main`, deployed by the poller.

## Decided in this session

| Topic | Decision |
|---|---|
| Sign-up on dev | **Open, as the map says.** dev.agenticlibrary.app and agenticlibrary.app both run `SIGNUP=open`. Accounts on dev are real accounts holding real data, and they're separate from production's. |
| Order on GitHub | **Private first, verified, then public.** The new repo is created private and the rewritten `main` is pushed to it. The audit is re-run against a fresh clone of the remote, and CI and both deploys go green. Only then does it switch to public. Up to that switch, every step can be undone. |
| Timing | **One sitting.** Once the repo checks pass, sign-up opens in the same session, after a go/no-go list. |

## Assumptions (accepted 2026-11-25)

1. **The deploy key is moved, not regenerated.** GitHub refuses a public key that's already a deploy key on another
   repo, so it's deleted from the archive first and then added to the new repo, read-only. The private key never
   leaves the server, and the deploy script doesn't change.
2. **The archive is named `agentic-library-archive`,** has Actions turned off, and is archived (read-only) once the
   launch checks pass. It is never deleted.
3. **The server token is replaced, not edited.** Fine-grained tokens are bound to a repository ID. A new token for
   the new repo, with the same four permissions from [SPEC-repo-security.md](SPEC-repo-security.md), is installed, and
   the old one is revoked.
4. **The About box:** description "Folio is a calm place to read on any screen: read-aloud, highlights in one place,
   and questions that only see the pages you've read. Free at agenticlibrary.app." Homepage
   `https://agenticlibrary.app`. Topics `reading`, `ebooks`, `epub`, `audiobooks`, `tanstack-start`, `react`,
   `postgres`. GitHub's Community standards checklist counts the description.
5. **Before the switch, dev and production both run the tip of `main`.** The redeploy from the new repo then changes
   commit SHAs but not code. Each new commit's tree is identical to the old one's.
6. **There are no open PRs** on the current repo (0 on 2026-11-25), and none are opened during the launch. Old PRs stay
   in the archive and aren't recreated.

## What the other specs hand over

| From | Step for `go-public` |
|---|---|
| `publish-audit` | Re-run the audit right before launch. Perform the author email rewrite with `git filter-repo --mailmap` in a fresh clone, prove that only the email fields changed, and push only `main`. Redeploy dev and production from the new `main`. |
| `repo-security` | There is no runner to move. Run `settings.ts --apply` and `--check` on the new repo until there are no differences, including the rows that can only be set once the repo is public. Re-create the deploy key and the environments, and re-scope the server token. |
| `instance-limits` | Before `SIGNUP=open`, check that the account page shows the hosted values, "of 1 GB" and "of 100 MB", on dev and production. |
| `legal-and-attribution` | Set `SOURCE_URL=https://github.com/orhunakkan/agentic-library` on dev and production, restart, and check both footers' Source code link. Before `SIGNUP=open`, check that the owner has read Terms, Privacy and Copyright and that the `SITE_CONTACT` inbox is read. |
| `contributor-docs` | Check the issue chooser (two forms, three links, no blank issue), Insights → Community standards, and that GitHub detects the licence as MIT. |

## Preconditions

Every one must hold before step 1. If one doesn't, the launch waits.

- Every module in the map's Progress table is **Built**, including `billing-removal`'s release 2 (the drop
  migration), and live on production.
- `pnpm check`, `pnpm test:db` and `pnpm test:browser` pass on the tip of `main`. The last CI run on `main` is green on
  GitHub-hosted runners.
- Dev and production both run that tip, as their latest `success` deployment statuses show.
- `spec/publish-audit-report.md` is signed off by the owner.
- The owner's `git config --global user.email` is `70279053+orhunakkan@users.noreply.github.com`, and GitHub's "Block
  command line pushes that expose my email" is on. Both are `publish-audit` owner steps.
- `git-filter-repo` is available. Installing it is an ask-first step.
- The working tree is clean, `main` is the only local branch, and there are no stashes, worktrees or tags.
- `node scripts/github/settings.ts --check` on the current repo differs only in the rows marked "applied by
  `go-public`".
- The owner has read how the server's deploy script fetches code (`/usr/local/bin/agentic-library-deploy`) and
  confirmed that it fetches a SHA rather than fast-forwarding a branch, because the new history isn't related to the
  old one. See Risks.

**Freeze:** from step 1 until step 6 is done, nobody commits to `main`, and no Claude session pushes.

## Run-book

Each step lists who runs it and the check that ends it. Steps 1 to 7 can be undone (see [Abort](#abort)). Step 8 makes
the repo public and can't be undone. Commands are in [Commands](#commands).

### 1. Final audit (Claude)

Re-run `publish-audit` on the tip of `main`:

- **Full re-run of the automated checks:** gitleaks over every commit on `main` and over the tracked files, the
  canary check, the author and committer list, and the email and infrastructure `grep`s.
- **Reading, only since the sign-off:** every commit message added after the report's sign-off, every file deleted
  since then, and the metadata of every binary file added or changed since then.
- Results go in a new dated section, "Re-run before go-public", at the end of `spec/publish-audit-report.md`.

**Check:** 0 unallowed findings, the canary is caught, and nothing new needs accepting. If something does, the owner
decides before step 2.

### 2. Back up and freeze locally (Claude)

- Commit the report section, which is the last commit made on the old history.
- Write a bundle of the old `main` **outside the repo**, to `~/backups/agentic-library-pre-public.bundle`. It's a
  second copy next to the archive.
- Record the old `main`'s SHA and commit count in the go-public report.

**Check:** `git bundle verify` passes.

### 3. Rewrite (Claude)

In the scratchpad, never in the working repo, as `publish-audit` defined and dry-ran it:

- `git clone --no-local --single-branch --branch main` the working repo into `$SCRATCH/public`.
- Write `$SCRATCH/mailmap` by hand. The personal address is only typed into that file, which is never committed and is
  deleted at step 11.
- Run `git filter-repo --mailmap`.
- Compare old and new commit by commit: tree, author name, author date, committer name, committer date and message.

**Check:** `cmp` finds no difference. The only email left in `%ae` and `%ce` is the no-reply address. The commit count
matches. `git log -p` finds no trace of the personal address.

### 4. Retire the old repo's deploy path (owner, then Claude)

1. **Owner:** stop the poller timer on the server. Deployment requests wait until it starts again, and the sites keep
   running.
2. **Claude:** delete the deploy key from the current repo, after writing down its public key and title.
3. **Claude:** turn Actions off on the current repo.
4. **Claude:** rename the current repo to `agentic-library-archive`.

**Check:** `gh repo view orhunakkan/agentic-library-archive` shows a private repo, and `orhunakkan/agentic-library`
redirects to it, until step 5 takes the name.

Between this step and the end of step 5, **nothing is pushed** to `orhunakkan/agentic-library`. The redirect would
send it to the archive.

### 5. Create the new repo, private (Claude)

1. `gh repo create orhunakkan/agentic-library --private` with the description and homepage from Assumption 4, and
   the topics.
2. Add the deploy key from step 4, with the same title, read-only.
3. `node scripts/github/settings.ts --apply`, then `--check`. These run **before** the push, so the first CI run
   already enforces SHA pinning and finds the `dev` and `production` environments with their `main`-only policy.
4. Push from `$SCRATCH/public`: `main` only, to `refs/heads/main`. No `--force`, no `--all`, no `--tags`.

**Check:** `--check` differs only in the "applied by `go-public`" rows. `git ls-remote` lists only `HEAD` and
`refs/heads/main`, at the rewritten SHA.

### 6. Switch the local clone (Claude)

The working clone still has the old `main`, whose history isn't related to the new one, and its `origin` URL now
names the new repo.

- `git fetch origin`, then `git reset --hard origin/main`. The tree is the same, so only the SHAs change.
- Expire the reflog and run `git gc --prune=now`, so no old commit is left in the clone to push by mistake. The bundle
  from step 2 and the archive hold them.

**Check:** `git log --format='%ae%n%ce' | sort -u` prints only the no-reply address. `git status` is clean and up to
date with `origin/main`.

The freeze ends here.

### 7. Verify on GitHub while private (owner and Claude)

1. **Owner:** create the new fine-grained token for the new repo, with Actions: read, Contents: read, Deployments:
   read and write, and Metadata: read. Install it in the root-only file, run `poll.ts --dry-run`, then start the
   timer again.
2. **Claude:** a fresh `--mirror` clone of the remote into the scratchpad. Re-run gitleaks over all of its history
   with the real `.gitleaks.toml`, list its refs, and check its emails, commit count and `HEAD` tree.
3. **CI:** the push from step 5 runs the full suite. Secrets scan sees a base SHA of all zeros, so it scans every
   commit.
4. **Dev:** `request-dev-deploy` creates the `dev` deployment, and the poller deploys it.
5. **Production (owner):** `gh workflow run deploy-prod.yml -f sha=<new main SHA>`.

**Check (go/no-go for step 8):**

- the mirror clone has only `refs/heads/main`, 0 gitleaks findings, only the no-reply email, the recorded commit count,
  and a `HEAD` tree equal to the old `main`'s;
- every CI job is green, including Secrets scan and Workflow lint;
- `dev` and `production` deployments of the new SHA are `success`, and both sites answer `ok` on `/healthz`.

If anything fails, stop and fix it, or abort. Nobody outside can see the repo yet.

### 8. Make it public (Claude, with the owner's go) — can't be undone

1. `gh repo edit --visibility public --accept-visibility-change-consequences`.
2. `node scripts/github/settings.ts --apply`, then `--check`. Now the rest applies too: both rulesets, secret
   scanning with push protection, private vulnerability reporting and fork PR approval.

**Check:** `--check` reports **no differences**. The rules API for `main` lists deletion, non-fast-forward, pull
request and required status checks. The license API reports `mit`.

The window between 1 and 2 is a few minutes. During it, only the owner can push, because the owner is the only
collaborator.

### 9. Point the sites at the source (owner, then Claude)

1. **Owner:** add `SOURCE_URL=https://github.com/orhunakkan/agentic-library` to the dev and production env files and
   restart both.
2. **Claude:** check that the Source code link in both footers, `SiteFooter` and `HomeFooter`, opens the repo on dev
   and on production.
3. **Claude and owner:** check that Insights → Community standards is complete, the community profile API reports
   100%, and the issue chooser shows the bug and feature forms and the three contact links with no blank issue. The
   chooser is checked in a browser signed out, or in a private window.

### 10. Close the archive (Claude)

- Archive `orhunakkan/agentic-library-archive` (read-only). It stays private.
- **Owner:** revoke the old server token.

**Check:** `gh repo view` shows it archived and private. The new repo's settings `--check` still reports no
differences.

### 11. Open sign-up (owner and Claude)

**Go/no-go.** Every item holds on **both** dev and production:

- the account page's Storage section says "of 1 GB" and "of 100 MB" (`instance-limits`);
- the owner has read Terms, Privacy and Copyright on that site, and someone reads the `SITE_CONTACT` inbox
  (`legal-and-attribution`);
- mail is set up for real: `MAIL_TRANSPORT=resend`, a `MAIL_FROM` on a domain that Resend shows as verified (SPF
  and DKIM), the `resend_api_key` and `resend_webhook_secret` credentials, and a Resend webhook for that site's
  `/mail/events`;
- `SITE_CONTACT` is set. Production refuses to start with `SIGNUP=open` without it;
- the disk holding audiobooks has well over 10 GB free (`MIN_FREE_BYTES`).

Then, **dev first, then production**:

1. **Owner:** set `SIGNUP=open` in the env file and restart. The site refuses to start if mail or `SITE_CONTACT` is
   missing, which is itself a check.
2. **Rehearsal**, in a private window:
   - Request a sign-up link to an inbox the owner reads. The mail arrives, and its headers show SPF and DKIM `pass`.
   - Finish sign-up, sign in, and check that the Storage section shows the hosted values and that the sign-up page
     links Terms and Privacy.
   - Request a link to `bounced@resend.dev`. The webhook marks the address bounced, so a second request for it
     gets the bounced outcome.
   - Delete the test account from the account page. The activity log shows `signup.requested` and the deletion.
3. Production only after dev's rehearsal passes.

`/mail/events` and the bounce handling exist in the code today
([webhook.ts](../src/server/mail/webhook.ts)). The rehearsal checks that each site's Resend webhook reaches them.

### 12. Watch (owner), first 7 days

Once a day: the server journal for errors on both sites, `signup.requested` outcomes in the activity log (`busy` means
the daily cap of 30 was hit), Resend's bounce and complaint rates, free disk space, and new fork PRs and Dependabot
PRs. Anything found becomes a normal issue or PR on the new repo.

## Abort

Before step 8, the launch can be undone completely:

1. Stop the poller.
2. Delete the new private repo. This needs `gh auth refresh -s delete_repo` first (ask first).
3. Delete the deploy key from it if the repo still exists, rename the archive back to `agentic-library`, turn its
   Actions on again, and add the deploy key back.
4. Reinstall the old token and start the poller.
5. In the working clone, restore from the bundle: `git fetch <bundle> main` and `git reset --hard FETCH_HEAD`.

After step 8, anyone may have cloned or forked the repo. Making it private again doesn't take those copies back. If a
secret turns up after the switch, `publish-audit`'s rule applies: **rotate it first**, then decide.

Rolling back sign-up at any time: set `SIGNUP=invite` and restart. Existing accounts keep working, and new sign-up
requests are turned away.

## Commands

```
# Preconditions
git status --porcelain && git branch --list && git stash list && git worktree list && git tag
git config --global user.email                     # the no-reply address
gh pr list --repo orhunakkan/agentic-library --state open
node scripts/github/settings.ts --check

# 1. Final audit: the commands in SPEC-publish-audit.md, unchanged

# 2. Bundle
git bundle create ~/backups/agentic-library-pre-public.bundle main && git bundle verify ~/backups/agentic-library-pre-public.bundle

# 3. Rewrite and proof (the publish-audit dry run, for real)
git clone --no-local --single-branch --branch main /home/orhunakkan/agentic-library "$SCRATCH/public"
git -C "$SCRATCH/public" filter-repo --mailmap "$SCRATCH/mailmap"
git -C /home/orhunakkan/agentic-library log main --format='%T%x00%an%x00%ad%x00%cn%x00%cd%x00%B' > "$SCRATCH/before"
git -C "$SCRATCH/public" log main --format='%T%x00%an%x00%ad%x00%cn%x00%cd%x00%B' > "$SCRATCH/after"
cmp "$SCRATCH/before" "$SCRATCH/after"
git -C "$SCRATCH/public" log main --format='%ae%n%ce' | sort -u

# 4. Retire the old deploy path
gh api repos/orhunakkan/agentic-library/keys                          # note id, title, key
gh api -X DELETE repos/orhunakkan/agentic-library/keys/<id>
gh api -X PUT repos/orhunakkan/agentic-library/actions/permissions -F enabled=false
gh repo rename agentic-library-archive --repo orhunakkan/agentic-library --yes

# 5. New repo, private
gh repo create orhunakkan/agentic-library --private --disable-wiki \
  --description "<Assumption 4>" --homepage https://agenticlibrary.app
gh repo edit orhunakkan/agentic-library --add-topic reading,ebooks,epub,audiobooks,tanstack-start,react,postgres
gh api -X POST repos/orhunakkan/agentic-library/keys -f title="<same title>" -f key="<same public key>" -F read_only=true
node scripts/github/settings.ts --apply && node scripts/github/settings.ts --check
git -C "$SCRATCH/public" push https://github.com/orhunakkan/agentic-library.git main:refs/heads/main
git ls-remote https://github.com/orhunakkan/agentic-library.git

# 6. Local clone
git fetch origin && git reset --hard origin/main
git reflog expire --expire=now --all && git gc --prune=now

# 7. Verify the remote
git clone --mirror https://github.com/orhunakkan/agentic-library.git "$SCRATCH/remote.git"
git -C "$SCRATCH/remote.git" for-each-ref
docker run --rm -v "$SCRATCH/remote.git:/repo:ro" -v "$PWD/.gitleaks.toml:/config.toml:ro" \
  ghcr.io/gitleaks/gitleaks@sha256:<digest> git /repo --config /config.toml --redact
gh run list --repo orhunakkan/agentic-library --branch main --limit 1
gh api repos/orhunakkan/agentic-library/deployments --jq '.[] | {environment, sha}'
gh workflow run deploy-prod.yml --repo orhunakkan/agentic-library -f sha=<sha>    # owner
curl -fsS https://dev.agenticlibrary.app/healthz && curl -fsS https://agenticlibrary.app/healthz

# 8. Public
gh repo edit orhunakkan/agentic-library --visibility public --accept-visibility-change-consequences
node scripts/github/settings.ts --apply && node scripts/github/settings.ts --check
gh api repos/orhunakkan/agentic-library/rules/branches/main --jq '.[].type'
gh api repos/orhunakkan/agentic-library/license --jq .license.spdx_id

# 9. Community
gh api repos/orhunakkan/agentic-library/community/profile --jq .health_percentage

# 10. Archive
gh repo archive orhunakkan/agentic-library-archive --yes
```

Server commands (`systemctl stop|start folio-deploy-poll.timer`, `poll.ts --dry-run`, editing env files, restarts)
are the owner's, as installed by `repo-security`.

## Files

```
spec/publish-audit-report.md    Adds "Re-run before go-public" (step 1)
spec/go-public-report.md        New: the launch log. Each step's date, what ran, the check's result, and the old and new main SHAs
spec/capability-map.md          Progress: go-public Built, and the Status line
spec/SPEC-go-public.md          Status: implemented
```

No source code changes are planned. If a check fails because of a bug, the fix is a normal commit on the new `main`,
following [CODE_STANDARDS.md](../CODE_STANDARDS.md), and the step is run again.

Never committed: `$SCRATCH/mailmap`, the bundle, and token values.

## Code style

There's no code. The launch log is the artifact, one entry per step, with no secret values or personal address:

```markdown
## 5. Create the new repo, private — 2026-12-02

- Ran: `gh repo create orhunakkan/agentic-library --private …`, deploy key added (read-only), `settings.ts --apply`
- `settings.ts --check`: differs only in main-history, main-changes, secret scanning, private vulnerability
  reporting, fork PR approval (expected while private)
- Pushed `main` at 3f9c…e21a (73 commits); `git ls-remote`: HEAD, refs/heads/main
- Result: pass
```

## Testing strategy

The launch checks are the tests. Each step ends with one, and the run-book doesn't move on until it passes.

- **Rehearsed already:** the email rewrite and its proof are `publish-audit`'s dry run. Step 3 runs the same commands
  on the real history.
- **The private window is the rehearsal for the rest:** CI on a fresh repo, Secrets scan with an all-zeros base, the
  deploy key, the new token, the poller, and both deploys are all proven in step 7 before anything is public.
- **Verify on the remote, not locally:** step 7 audits a mirror clone of what GitHub actually holds.
- **Sign-up rehearsal on each site** with a real inbox and Resend's bounce address (step 11).
- `pnpm check` passes after the report commits.
- No coverage floors change.

## Boundaries

- **Always:**
  - stop at each step's check, and record the result in `spec/go-public-report.md`;
  - verify against GitHub (`ls-remote`, the mirror clone, `settings.ts --check`), not against what was meant to be
    pushed;
  - run `settings.ts --check` after every `--apply`;
  - keep the personal address and token values out of everything committed, printed or logged.
- **Ask first:** each GitHub and server change, one at a time. Approval for one step doesn't cover the next. That
  includes installing `git-filter-repo`, deleting or adding the deploy key, the rename, creating the repo, the push,
  each `--apply`, the visibility switch, archiving, `gh auth refresh -s delete_repo`, and each env-file change.
- **Never:**
  - push anything but `main`, or push with `--force`, `--all` or `--tags`;
  - push from the working clone before step 6;
  - switch to public before step 7's go/no-go passes;
  - set `SIGNUP=open` before step 11's go/no-go passes on that site;
  - rewrite history in the working repo;
  - commit the mailmap or the bundle;
  - delete the archive;
  - recreate old PRs or issues on the new repo;
  - print a token, a key or an environment value.

## Success criteria

- [ ] `orhunakkan/agentic-library` is public. Its only ref is `refs/heads/main`, and it has no tags or releases.
- [ ] Every commit's author and committer email is `70279053+orhunakkan@users.noreply.github.com`. The commit count
      and each commit's tree, names, dates and message match the old `main` (`cmp` shows no difference).
- [ ] A mirror clone of the public repo has 0 gitleaks findings with the real config, and its `HEAD` tree equals the
      old `main`'s.
- [ ] `settings.ts --check` reports **no differences** on the public repo.
- [ ] The rules API for `main` shows deletion, non-fast-forward, pull request and required status checks. Secret
      scanning with push protection and private vulnerability reporting are on.
- [ ] GitHub reports the licence as `mit`, the community profile at 100%, and the issue chooser shows two forms and
      three links with no blank issue.
- [ ] The first push's CI run is green on every job, and Secrets scan covered every commit.
- [ ] Dev and production both run the new `main` SHA, deployed by the poller with the new token, with `success`
      statuses. `/healthz` answers `ok` on both.
- [ ] The Source code link in both footers opens the public repo on dev and on production.
- [ ] `orhunakkan/agentic-library-archive` is private, archived, with Actions off and no deploy key. The old server
      token is revoked.
- [ ] The local clone's `main` equals `origin/main`, and its history holds only the no-reply address.
- [ ] `SIGNUP=open` on dev and production. On each, a test account signed up through a real inbox, saw the hosted
      limits, and was deleted, and a mail to `bounced@resend.dev` was marked bounced.
- [ ] `spec/go-public-report.md` records every step with its date and result. The capability map shows `go-public`
      as Built.

## Risks

- **The deploy script may not handle unrelated history.** If it runs `git pull` or `merge --ff-only`, the first deploy
  from the new repo fails. Mitigation: the owner reads it before step 1 (a precondition). Step 7 proves it while
  the repo is still private, and the abort path is open until step 8.
- **A push lands in the archive.** Between step 4's rename and step 5's create, `orhunakkan/agentic-library`
  redirects to the archive. Mitigation: the freeze, and steps 4 and 5 run back to back.
- **An old commit reaches the new repo.** A stray push of an old branch would publish the personal address.
  Mitigation: step 6 removes the old objects from the clone, `main-history` blocks force pushes, and GitHub's
  email-blocking setting refuses such pushes. The bundle and the archive are the only old copies.
- **Mistakes after the switch can't be taken back.** Forks and clones keep whatever was public. Mitigation: everything
  is verified on the remote while it's private (step 7), and step 8 needs the owner's explicit go.
- **Dev holds real user data.** With sign-up open on dev, every push to `main` deploys to a site with strangers'
  accounts before production has tested it, and some people will sign up on dev by mistake. Accepted by the owner.
  Dev gets the same limits, Terms, contact and care as production.
- **No database backups.** The Privacy page says so ("Folio has no backups yet"), so users are told, but a disk failure
  would lose their data. Accepted for V1, and backups are specced next (see Decisions).
- **The daily sign-up cap.** `SIGNUP_DAILY_LIMIT` is 30 a day for each site. If a launch draws more, new visitors see
  "busy". Accepted. Raising it is a code change, and step 12 watches for `busy`.
- **Private Actions minutes.** Step 7 runs one full CI run, about 20 minutes, on the private plan's quota. This is
  accepted, and `repo-security` already budgets for it.
- **Token expiry.** The new server token's expiry date starts a new reminder for the owner, as in `repo-security`.

## Out of scope (deferred)

- Announcing the launch (a post, Show HN, a social preview image): a separate decision once the repo is public.
- Database backups: their own module, specced right after this one. Launch doesn't wait for them, because the
  Privacy page tells users there are none.
- Releases, tags and a changelog: V1 deploys from `main`, and nothing is versioned.
- GitHub Discussions, Sponsors and an OpenSSF Scorecard badge: these were already deferred by the map and by
  `repo-security`.
- A `/healthz` that reports the running commit. The deployment statuses record it.
- Rewriting the `#N` references, or recreating the old PRs and issues: accepted as they are by `publish-audit`.
- Raising `SIGNUP_DAILY_LIMIT` or making it operator config: only if step 12 shows it's needed.

## Changes to other specs

Made in this session:

- **Capability map:** the Progress row for `go-public` points to this spec. The `go-public` row in the module table
  gets "private first, verified, then public", and says that sign-up opens on dev and production in the same sitting.

Nothing is handed over. This is the last module.

## Decisions

- **Sign-up on dev: open,** as the map says. *(2026-11-25)*
- **The new repo is created private, verified on the remote, then made public.** *(2026-11-25)*
- **Sign-up opens in the same sitting as the switch,** after the go/no-go list, dev first. *(2026-11-25)*
- **No backups before launch.** Privacy already says there are none, so a backup isn't a go/no-go item. A backups
  spec comes next. *(2026-11-25)*
- **Assumptions 1 to 6 accepted as written,** including the About text and the topics. *(2026-11-25)*

## Open questions

None.
