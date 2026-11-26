# Implementation Plan: publish-audit

Source spec: [spec/SPEC-publish-audit.md](../spec/SPEC-publish-audit.md) (approved 2026-11-25)

Tasks: [tasks/publish-audit-todo.md](publish-audit-todo.md)

## Overview

Before `main` is pushed to a new public repo (path A), check it for secrets, personal data, infrastructure details and
file metadata. Then dry-run the author email rewrite that `go-public` will perform. The deliverables are two committed
files, `.gitleaks.toml` and `spec/publish-audit-report.md`, and the owner's dated sign-off on the report. No source
code changes.

## Facts checked while planning (2026-11-25)

These differ from the spec's numbers, or the spec didn't state them:

- **`main` has 74 commits now, not 68.** The module-spec commits were added after the spec was written, and more will
  come while other modules are built. The report records the commit count and the `main` SHA it scanned, and
  `go-public` re-runs the audit at its own SHA.
- **1 commit has `GitHub <noreply@github.com>` as committer.** All 74 authors are the personal address. This conflicted
  with the success criterion "the only author and committer email left is the no-reply address". See Decisions.
- **27 tracked binaries:** 12 images, 6 audio files, 3 PDFs, 4 EPUBs and 2 ZIPs, which matches the spec. The spec's
  exiftool command leaves out `*.zip`, and EPUBs and ZIPs are archives, so their inner files need checking too (the OPF
  `dc:creator` and `dc:publisher` fields, and any images inside).
- **21 files were deleted** in `main`'s history: `scripts/issue-loop/` (5), `docs/agents/` (4), `docs/adr/` (2),
  `SPEC.md`, `CLAUDE.md`, `CODING_STANDARDS.md`, `GLOSSARY.md` and 6 source files.
- **Fake keys in the tree are more varied than the spec's sample allowlist.** For example, `sk-proj-0123456789abcdefghij`,
  `pdl_ntfset_theoldsecret` and `sk-ant-api03-a-key-that-must-not-be-logged` aren't covered by it. The allowlist is
  built from what gitleaks actually reports, not from the sample.
- Neither gitleaks, exiftool nor git-filter-repo is installed. Docker works.

## Architecture Decisions

- **Scanner trust comes first.** The config and the canary check (Tasks 1–3) come before any audit result, because a
  clean scan means nothing until the canary is caught.
- **The allowlist is driven by findings.** Run gitleaks with the default rules and no allowlist, then allow only the
  values it reports that are clearly fake, each by exact value or a narrow pattern. Paddle keys stay in the allowlist
  even though `billing-removal` deletes those tests, because the history scan still sees them.
- **The report is built one section at a time.** Each audit task writes its own section of
  `spec/publish-audit-report.md`, so the report always shows what has been checked so far.
- **Scratch work lives in the session scratchpad.** That covers clones, the canary, the mailmap, raw scan output and the
  before/after listings. None of it is committed. The personal address is typed only into the mailmap on disk.
- **Images are pinned by digest**, not by tag, and the exact `docker run` lines go into the report.
- **Commit only when the owner asks**, straight to `main` as the project's memory says. Nothing is pushed.

## Task List

### Phase 1: A scanner you can trust
- [ ] Task 1: Pin the scanner images and take a baseline gitleaks run
- [ ] Task 2: Write `.gitleaks.toml` with a narrow allowlist
- [ ] Task 3: Canary check and report skeleton

### Checkpoint: Scanner
- [ ] Canary caught with the real config; every allowlist entry matches a known fake key; owner reviews the allowlist

### Phase 2: The audit
- [ ] Task 4: Secrets scan of history and tree
- [ ] Task 5: File metadata audit
- [ ] Task 6: Personal data and infrastructure scan
- [ ] Task 7: Read deleted files and commit messages

### Checkpoint: Audit
- [ ] 0 unallowed findings, or every finding rotated and recorded; owner decides on any stripping or removal

### Phase 3: Email rewrite and sign-off
- [ ] Task 8: Email rewrite dry run
- [ ] Task 9: Finish the report and run `pnpm check`
- [ ] Task 10: Owner sign-off and progress update

### Checkpoint: Complete
- [ ] Every success criterion in the spec is ticked, and the owner has signed the report

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A real secret is in history | High | Stop. Rotate at the provider first, then ask whether to remove it from history. The report names the file, commit and kind, never the value. |
| gitleaks in a container refuses the `:ro` repo ("dubious ownership") | Med | Pass `-e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=*`, or run as `--user $(id -u)`. Record the working command. |
| The allowlist is too broad and hides a real key | High | Canary check, plus a second canary: a real-shaped key in a test file named like the existing fakes must still be caught. |
| git-filter-repo isn't installed when Task 8 starts | Low | Check `git filter-repo --version` first. If it's missing, stop and ask the owner to run `sudo pacman -S git-filter-repo`. |
| There's no official exiftool image | Low | Pick a widely used image, pin it by digest and record it. Or run `perl-image-exiftool` in a pinned Perl container. |
| Metadata hides inside EPUBs and ZIPs | Med | Unzip each into the scratchpad and run exiftool and an OPF read on the inner files. |
| The personal address shows up in scratch output that's pasted into the report | High | Before every commit, grep the staged files for the personal address and its domain. |
| Counts drift before `go-public` | Low | The report records the SHA and count it scanned. `go-public` re-runs the documented commands. |

## Decisions

- **The GitHub committer commit is accepted as public.** One commit's committer is `GitHub <noreply@github.com>`,
  GitHub's own address rather than personal data. It's left as it is, because rewriting it would also mean changing the
  committer name. After the rewrite, the only emails left are the no-reply address and `noreply@github.com`.
  *(2026-11-25)*
- **git-filter-repo is installed with pacman** (`sudo pacman -S git-filter-repo`), because `go-public` needs it again
  for the real rewrite. The owner runs the install, since it needs sudo. *(2026-11-25)*
- **Plan files are named per module**, `tasks/<module>-plan.md` and `tasks/<module>-todo.md`. *(2026-11-25)*

## Open Questions

None.
