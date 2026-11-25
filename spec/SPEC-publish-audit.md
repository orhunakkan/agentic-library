# Spec: publish-audit — V1

Status: approved (2026-11-25)

Module of [capability-map.md](capability-map.md). Depends on nothing. `go-public` re-runs this audit right before
launch.

## Objective

Before anything becomes public, find every secret, personal detail and private piece of history that would be
published with it. Then either remove it or record that it's accepted as public. The result is a written report the owner
signs off, plus a scanner configuration that `repo-security` and `go-public` can re-run.

**Who it's for:** the owner, deciding whether it's safe to publish.

## What gets published depends on how the repo goes public

The local clone isn't everything. The GitHub repository `orhunakkan/agentic-library` holds more than `main`, as of
2026-11-25:

| On GitHub | Count | In the local clone? |
|---|---|---|
| Commits on `main` | 68 (since 2026-11-22) | yes |
| Pull requests (`refs/pull/*`) | 69, the oldest from 2026-03-22. 65 predate November, and 27 carry `TAB…` ticket keys from earlier lab work. | **28 PR head commits are not** |
| Issues | 10 (#153–#162) | no |
| Workflow runs, with full logs | 1,095 | no |
| Artifacts (`playwright-report`) | 7, from 17 to 118 MB | no |
| Wiki, Projects | enabled | not checked |
| Environments, variables, deploy key, runner | `dev` and `production`, `CI_RUNNER`, 1 deploy key, runner `LINUX-LAPTOP` | — |

Flipping the repo to public publishes every row in that table. GitHub doesn't let you delete pull requests, only
issues, so PR titles, descriptions, comments and the commits behind them can't be removed afterwards.

**Decided: path A, a new public repo with `main` only.** The current repo is renamed to a private archive, for
example `agentic-library-archive`. A new public `orhunakkan/agentic-library` is created, and only `main` is pushed to
it. The full history of `main` is kept, as decided in the map. PRs, issues, run logs, artifacts, the wiki and the
pre-November history stay private in the archive. **Audit scope: the commits on `main` plus the tracked files.**

*Rejected: flipping the repo in place.* It would publish everything in the table above, including PRs that can never be
deleted, and the audit would have to cover all of it.

Consequences, handled by the `go-public` spec:
- the deploy key and the `dev` and `production` environments are set up again on the new repo, and the server's
  deploy token is re-scoped to it. The self-hosted runner and `CI_RUNNER` are gone by then, because
  [repo-security](SPEC-repo-security.md) removes them;
- `git remote` changes on the laptop and the deploy machine;
- **accepted:** 61 commit messages on `main` mention `#N` PR or issue numbers. In the new repo those numbers link to
  that repo's own issues and PRs, which won't match. They are left as they are.

## Author email rewrite

**Decided:** before the first push, `main` is rewritten so that every commit's author and committer email is the
owner's GitHub no-reply address, `70279053+orhunakkan@users.noreply.github.com`. Names, dates, messages, trailers such
as `Co-Authored-By`, and file contents stay byte-for-byte the same. Only the email fields change, which changes every
commit SHA.

- **This module defines and dry-runs the rewrite. `go-public` performs it**, as its last step before pushing, so
  commits made while the other modules are built are covered too.
- **Tool:** `git filter-repo --mailmap` in a fresh `--no-local` clone, never in the working repo. filter-repo isn't
  installed, so installing it is an ask-first step: `pacman -S git-filter-repo`, or the single-file script run once.
- **Mailmap:**
  `Orhun Akkan <70279053+orhunakkan@users.noreply.github.com> <personal address>`. The personal address is only
  typed in the file on disk and never committed.
- **Proof it changed nothing else:** for every commit, old and new have the same tree hash (`%T`), message (`%B`),
  author name and dates. Only `%ae` and `%ce` differ. A script compares the two `git log` listings line by line.
- **Owner steps (manual):**
  - set `git config --global user.email 70279053+orhunakkan@users.noreply.github.com` now, so new commits don't need
    rewriting;
  - turn on GitHub's "Block command line pushes that expose my email".
- **After the rewrite:** the commits deployed on dev and prod no longer exist in the public repo, so `go-public`
  redeploys both from the new `main`.

## What the audit checks

1. **Secrets in history.** gitleaks over every commit being published, meaning the commit diffs, not just the current
   files. This includes files since deleted, such as `SPEC.md`, `scripts/issue-loop/*` and `docs/agents/*`.
2. **Secrets in the current tree.** gitleaks over the tracked files only.
3. **The scanner actually works.** In a scratch clone, add a commit with a canary key shaped like a real one, run
   gitleaks, and confirm it reports the canary. A clean result counts only if the canary was caught.
4. **No broad allowlists.** Known fake test keys, such as `sk-ant-api03-this-is-a-fake-key-0000` and
   `pdl_sdbx_apikey_…test…`, are allowed **by exact value or a narrow pattern, never by path**. A real key pasted into
   a test file must still be caught.
5. **Personal data.** Email addresses, names, phone numbers and real postal addresses in the tracked files and commit
   messages. Known today:
   - the owner's name on the Terms and Privacy pages and in the footer, which the map accepts;
   - test addresses at `example.com`, `folio.test` and `resend.dev`, which are fine;
   - **the owner's personal email as the author of all 68 commits**, which the rewrite above removes. The audit then
     confirms that the personal address appears nowhere in the rewritten history, metadata or contents.
6. **Infrastructure details.** Hostnames, server paths, runner names, and sudo or deploy commands. Known today:
   `/usr/local/bin/agentic-library-deploy` with `sudo -n` in both workflows, plus `dev.agenticlibrary.app` and
   `agenticlibrary.app`. After `repo-security`, the `sudo -n` call moves from the workflows to the deploy poller in
   `scripts/deploy/`, which also names its install path and systemd units. The default is to accept them, since they
   don't grant access.
7. **File metadata.** EXIF and XMP data (GPS, camera, author, software paths) in the 12 tracked images, ID3 and MP4
   tags in the 6 audio fixtures, and document metadata in the 3 PDFs, 4 EPUBs and 2 ZIPs. Four of the images ship to
   users from `public/`.
8. **Deleted-file review.** Read the files that were deleted from `main`'s history, not just scan them, such as the
   agent permission settings in `scripts/issue-loop/*-settings.json` and `docs/agents/*`. Anything embarrassing or
   private gets recorded.
9. **Commit message review.** Read all 68 subjects and bodies on `main` for anything private.

## If a real secret is found

1. **Rotate it first**, at the provider: Anthropic, Paddle, Resend, GitHub, or the KEK via `scripts/db/rotate-kek.ts`.
   Rotating is what makes it safe; removing it from history alone isn't enough.
2. Then decide whether to remove it from history as well. It's cheap here, because `main` is rewritten before its
   first push anyway, and the old copies stay only in the private archive.
3. The report names the file, the commit and the kind of secret. **It never includes the value.**

## Commands

Neither tool is installed. Docker is, so the default is pinned container images and nothing new installed on the
machine:

```
# Secrets: commit history of main, then the tracked files
docker run --rm -v "$PWD:/repo:ro" ghcr.io/gitleaks/gitleaks:<pinned tag> \
  git /repo --log-opts="main" --config /repo/.gitleaks.toml --redact --report-path /dev/stdout
docker run --rm -v "$PWD:/repo:ro" ghcr.io/gitleaks/gitleaks:<pinned tag> \
  dir /repo --config /repo/.gitleaks.toml --redact

# Metadata
git ls-files -z '*.jpg' '*.png' '*.mp3' '*.m4b' '*.pdf' '*.epub' | xargs -0 docker run --rm -v "$PWD:/w:ro" -w /w \
  <exiftool image> -G1 -a -s

# Personal data and infrastructure
git log main --format='%an <%ae>%n%cn <%ce>' | sort -u
git log main --format='%B' | grep -nE '@|https?://|/home/|/usr/|/srv/'
git ls-files -z | xargs -0 grep -nIE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' | grep -vE 'example\.(com|org)|folio\.test|resend\.dev'

# Email rewrite dry run (in the scratchpad, never in the working repo)
git clone --no-local --single-branch --branch main /home/orhunakkan/agentic-library "$SCRATCH/rewrite"
git -C "$SCRATCH/rewrite" filter-repo --mailmap "$SCRATCH/mailmap"
git -C /home/orhunakkan/agentic-library log main --format='%T%x00%an%x00%ad%x00%cn%x00%cd%x00%B' > "$SCRATCH/before"
git -C "$SCRATCH/rewrite" log main --format='%T%x00%an%x00%ad%x00%cn%x00%cd%x00%B' > "$SCRATCH/after"
cmp "$SCRATCH/before" "$SCRATCH/after"
git -C "$SCRATCH/rewrite" log main --format='%ae%n%ce' | sort -u
```

The exact image tags are pinned during implementation, and the commands that actually ran go into the report.

## Files

```
.gitleaks.toml               Scanner config: default rules plus a narrow allowlist of fake test keys (committed)
spec/publish-audit-report.md What was scanned, findings, and what's accepted as public (committed, no secret values)
```

There are no source code changes. If metadata has to be stripped from a binary fixture, that's one commit per file
type, with the reason in the message.

`.gitleaks.toml` style: allow by exact value or a narrow pattern, and say why for each entry.

```toml
[extend]
useDefault = true

[allowlist]
description = "Fake keys used by tests; each is shaped like a real key on purpose"
regexes = [
  '''sk-ant-api03-(this-is-a-fake-key|a-test-key-that-is-long-enough|example-key|pasted-in-the-wrong-place)[-0-9a-z]*''',
  '''sk-proj-(this-is-a-fake-key|a-test-key-that-is-long-enough|example-key)[-0-9a-z]*''',
  '''pdl_(sdbx_apikey|ntfset)_[0-9a-z]*test[0-9a-z_]*''',
]
```

## Testing strategy

This is an audit, not a feature, so its "tests" are checks that the audit itself is trustworthy:

- **Canary check (required):** a canary secret committed in a scratch clone must be reported with the real
  `.gitleaks.toml`. If it isn't, the config allows too much and the audit fails.
- **Allowlist check:** every allowlist entry matches at least one existing fake key. Unused entries are removed.
- `pnpm check` still passes. Only `.gitleaks.toml` and the report are added, so nothing should change.

`repo-security` decides whether gitleaks also runs in CI and in the pre-commit hook. This module only provides the
config.

## Boundaries

- **Always:**
  - run scans read-only (`:ro` mounts) and in a scratch clone when anything needs committing, such as the canary;
  - use `--redact`;
  - keep secret values out of the report, the terminal summary and commit messages.
- **Ask first:**
  - installing anything on the machine, beyond pulling the two container images (this includes `git-filter-repo`);
  - any history rewrite other than the approved email dry run, such as removing a found secret;
  - stripping metadata from a file;
  - deleting anything on GitHub (runs, artifacts, issues).
- **Never:**
  - rewrite history in the working repo (only in a scratch clone);
  - commit the personal email address, including in the mailmap or the report;
  - change repository visibility (that belongs to `go-public`);
  - push to any remote;
  - allowlist by path or directory;
  - print a found secret's value.

## Success criteria

- [ ] gitleaks over all 68 commits on `main` reports **0 unallowed findings**, or every finding is rotated and recorded.
- [ ] gitleaks over the tracked files reports 0 unallowed findings.
- [ ] The canary check is caught, and the report shows it.
- [ ] Every allowlist entry is a value or a narrow pattern, and each matches an existing fake key.
- [ ] Every tracked image, audio, PDF, EPUB and ZIP file is listed in the report with "no personal metadata" or with
      what was stripped.
- [ ] The deleted files and all 68 commit messages are reviewed, and the report lists anything notable.
- [ ] The report has an **"Accepted as public"** list, covering at least the owner's name, the domains, the deploy
      script path, the deploy poller's install path and systemd units, the no-reply author address, and the `#N`
      references.
- [ ] **Email rewrite dry run:** in a scratch clone, every rewritten commit matches its original in tree, names,
      dates and message (`cmp` reports no difference). The only author and committer email left is the no-reply
      address. `git log --all -p` and the metadata of every commit contain no trace of the personal address.
- [ ] The report records path A, the no-reply address, and the exact rewrite command for `go-public` to run.
- [ ] The owner has read the report and signed it off with a dated line at the bottom.

## Out of scope (deferred)

- Running gitleaks in CI or pre-commit, and GitHub secret scanning or push protection: these belong to `repo-security`.
- Creating the new repo, re-creating the deploy key and the environments, and flipping visibility: these belong to
  `go-public`. Removing the self-hosted runner belongs to `repo-security`.
- Reviewing the private archive's old PRs and issues: they stay private, so there's nothing to audit.
- Performing the real email rewrite and the first push: these belong to `go-public`.
- Rewriting the `#N` references in commit messages: they are accepted as they are.

## Decisions

- **Publishing path:** A, a new public repo with `main` only. *(2026-11-25)*
- **Author email:** rewritten to `70279053+orhunakkan@users.noreply.github.com` before the first push. *(2026-11-25)*
- **`#N` references:** left as they are. *(2026-11-25)*

## Open questions

None.
