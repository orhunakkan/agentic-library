# Tasks: publish-audit

Plan: [tasks/publish-audit-plan.md](publish-audit-plan.md) · Spec: [spec/SPEC-publish-audit.md](../spec/SPEC-publish-audit.md)

`$SCRATCH` means this session's scratchpad. Boundaries that apply to every task: use `:ro` mounts and `--redact`, never
print a secret value, never write the personal email into a tracked file, never push, and never rewrite history in the
working repo.

**How this is built:** in one go, from Task 0 to Task 10, with no owner review in between. The owner reviews the finished
work once, at the end. The checkpoints are self-checks: if one fails, fix it and re-run it before moving on, don't stop
to ask. Anything that genuinely needs the owner goes in the report's **"Needs owner action"** section and the build
carries on. That covers a real secret to rotate, metadata worth stripping, and the sign-off. Nothing in that section is
done on the owner's behalf.

---

## Task 0: Preflight

**Description:** Before doing any work, confirm the tools are there: `docker info` works, and `git filter-repo
--version` works. The owner installs git-filter-repo with `sudo pacman -S git-filter-repo` before the build starts. If
either check fails, stop now and say what's missing. This is the only stop, and it comes before any work is done.

**Acceptance criteria:**
- [x] `docker info` and `git filter-repo --version` both succeed
- [x] `git status` is clean on `main`

**Dependencies:** None

**Estimated scope:** XS

---

## Task 1: Pin the scanner images and take a baseline gitleaks run

**Description:** Pull gitleaks and an exiftool image, pinned by digest, and confirm both run against the repo mounted
read-only. Run gitleaks with the default rules and no config over `main`'s history and the tracked files. Save the
redacted findings to `$SCRATCH/baseline-*.json`. This is the input for the allowlist.

**Acceptance criteria:**
- [x] Both images are pinned by `@sha256:` digest, and the exact `docker run` lines are written down for the report
- [x] The baseline history and tree scans finish, and every finding is sorted as either a fake test key or needing a look

**Verification:**
- [x] `docker run … gitleaks version` and `… exiftool -ver` print versions
- [x] Manual check: the baseline JSON has `"Secret": "REDACTED"` everywhere

**Dependencies:** Task 0

**Files likely touched:** none tracked (scratchpad only)

**Estimated scope:** XS

---

## Task 2: Write `.gitleaks.toml` with a narrow allowlist

**Description:** Create `.gitleaks.toml` with `[extend] useDefault = true`, plus an allowlist of exact values or narrow
patterns for the fake keys found in Task 1, and a comment on each entry saying why. Never allow by path.

**Acceptance criteria:**
- [x] Every allowlist entry matches at least one fake key found in history or the tree, and unused entries are removed
- [x] There are no `paths` and no directory allowlists. Each regex is anchored to a fake-looking stem, not to a bare
      prefix like `sk-ant-api03-`
- [x] With the config, both scans report 0 findings for the fakes sorted in Task 1

**Verification:**
- [x] Re-run both scans with `--config /repo/.gitleaks.toml`, and only the "needs a look" findings remain
- [x] Self-check: each entry has a comment saying why, and none would match a key without a fake-looking stem

**Dependencies:** Task 1

**Files likely touched:** `.gitleaks.toml`

**Estimated scope:** XS

---

## Task 3: Canary check and report skeleton

**Description:** In a `--no-local` scratch clone, commit two canaries: a real-shaped key in a new file, and a
real-shaped key in a test file next to the existing fakes. Generate both randomly, with no `test` or `fake` stem. Run
gitleaks with the real config and confirm both are caught. Then create `spec/publish-audit-report.md` with the scope
(path A, the `main` SHA and commit count), the tools and digests, the exact commands, and the canary result.

**Acceptance criteria:**
- [x] Both canaries are reported, by rule ID, with the real `.gitleaks.toml`
- [x] The report skeleton has a section for each of the spec's 9 checks, plus "Accepted as public" and "Sign-off"
- [x] The scratch clone is deleted afterwards. The working repo's `git status` shows only the two new files

**Verification:**
- [x] The scan's JSON output lists both canary findings
- [x] Manual check: the report contains no canary values

**Dependencies:** Task 2

**Files likely touched:** `spec/publish-audit-report.md`

**Estimated scope:** S

---

## Checkpoint: Scanner (after Tasks 1–3, self-check)
- [x] Canary caught, allowlist narrow and fully used. If not, tighten `.gitleaks.toml` and re-run Task 3 before going on

---

## Task 4: Secrets scan of history and tree

**Description:** Run gitleaks with the config over every commit on `main` (the commit diffs, including the deleted
files) and over the tracked files. Record the results in the report. If anything real turns up, don't stop and don't try
to rotate it. Record it under "Needs owner action" by file, commit, kind and provider, with the rotation step (for
example `scripts/db/rotate-kek.ts` for the KEK), and mark it as blocking `go-public`. Never print or record its value.
Then carry on with the rest of the audit.

**Acceptance criteria:**
- [x] History scan: 0 unallowed findings, or each one is listed under "Needs owner action" by file, commit and kind, with no value
- [x] Tree scan: 0 unallowed findings
- [x] The report records the commit count, the SHA and the exit codes

**Verification:**
- [x] Both commands exit 0 (or every non-zero finding is listed), and the output is saved to `$SCRATCH`

**Dependencies:** Checkpoint: Scanner

**Files likely touched:** `spec/publish-audit-report.md`

**Estimated scope:** XS

---

## Task 5: File metadata audit

**Description:** Run exiftool (`-G1 -a -s`) on all 27 tracked binaries, including the `*.zip` files the spec's command
leaves out. Unzip each EPUB and ZIP into `$SCRATCH` and check its inner images and the OPF metadata (`dc:creator`,
`dc:publisher`, `dc:contributor`). Look for GPS, camera serials, author or owner names, and software paths such as
`/home/…`. Pay most attention to the 4 files in `public/`.

**Acceptance criteria:**
- [x] The report has a table of all 27 files, each marked "no personal metadata" or with what was found
- [x] Nothing is stripped. Anything found goes under "Needs owner action" with the exact command that would strip
      it (one commit per file type if the owner approves it later)

**Verification:**
- [x] `git ls-files` count of those extensions matches the table's row count (27)

**Dependencies:** Task 1

**Files likely touched:** `spec/publish-audit-report.md`

**Estimated scope:** S

---

## Task 6: Personal data and infrastructure scan

**Description:** Run the spec's grep commands over the tracked files and commit messages for email addresses, names,
phone numbers, postal addresses, hostnames, server paths, runner names and sudo or deploy commands. Sort every hit into
fine (test domains), accepted as public, or needing action. Draft the "Accepted as public" list.

**Acceptance criteria:**
- [x] Every email hit outside `example.com`, `example.org`, `folio.test` and `resend.dev` is sorted
- [x] "Accepted as public" covers at least: the owner's name, `agenticlibrary.app` and `dev.agenticlibrary.app`,
      `/usr/local/bin/agentic-library-deploy` with `sudo -n`, the deploy poller's install path and systemd units (or a
      note that `repo-security` adds them later), `LINUX-LAPTOP`, the no-reply author address, the
      `GitHub <noreply@github.com>` committer on one commit, and the `#N` references
- [x] The personal address is mentioned only as "the personal address" and never written out

**Verification:**
- [x] Grepping the report for the personal address (and its domain) finds nothing

**Dependencies:** Task 3

**Files likely touched:** `spec/publish-audit-report.md`

**Estimated scope:** S

---

## Task 7: Read deleted files and commit messages

**Description:** Use `git show <last commit where it existed>:<path>` to read all 21 files deleted from `main`'s
history, focusing on `scripts/issue-loop/*-settings.json` and `docs/agents/*`. Read every commit subject and body on
`main`. Record anything private, embarrassing or revealing.

**Acceptance criteria:**
- [x] All 21 deleted paths are listed in the report, each marked "nothing notable" or with a note
- [x] All commit messages have been read, and anything notable is listed with its short SHA

**Verification:**
- [x] `git log main --diff-filter=D --name-only --format= | sort -u | wc -l` matches the report's list (21)

**Dependencies:** Task 3

**Files likely touched:** `spec/publish-audit-report.md`

**Estimated scope:** S

---

## Checkpoint: Audit (after Tasks 4–7, self-check)
- [x] Secrets, metadata, personal data, deleted files and messages all reviewed, and each has its report section
- [x] Every flagged item is either in "Accepted as public" with a reason, or in "Needs owner action"

---

## Task 8: Email rewrite dry run

**Description:** git-filter-repo was confirmed in Task 0 (installed with pacman, decided 2026-11-25). Clone `main`
with `--no-local` into `$SCRATCH/rewrite`. Write `$SCRATCH/mailmap`, the one file that holds the personal address, with
a single line that maps it to the no-reply address. Run `filter-repo --mailmap`, then compare the before and after
listings (`%T %an %ad %cn %cd %B`) with `cmp`. The one commit with committer `GitHub <noreply@github.com>` is left as
it is (decided 2026-11-25), so it doesn't get a mailmap line.

**Acceptance criteria:**
- [x] `cmp before after` reports no difference
- [x] `log --format='%ae%n%ce' | sort -u` shows exactly two addresses: the no-reply address and `noreply@github.com`,
      which the report lists under "Accepted as public"
- [x] `git -C $SCRATCH/rewrite log --all -p` and `git cat-file -p` on every commit contain no trace of the personal
      address
- [x] The report records the exact rewrite command for `go-public`, with the personal address shown as a placeholder

**Verification:**
- [x] Run the commands above. Delete the scratch clone and the mailmap afterwards

**Dependencies:** Checkpoint: Audit

**Files likely touched:** `spec/publish-audit-report.md`

**Estimated scope:** S

---

## Task 9: Finish the report, run `pnpm check` and commit

**Description:** Fill in the summary at the top of the report: path A, the no-reply address, the rewrite command, and
the final "Accepted as public" list. Then fill in "Needs owner action". It always lists the manual steps (set
`git config --global user.email` to the no-reply address, turn on GitHub's "Block command line pushes that expose my
email", and sign off), plus anything flagged in Tasks 4–7. Run `pnpm check`. Commit `.gitleaks.toml`, the report,
`spec/capability-map.md` and this file to `main` as one commit, with the attribution trailer. **Don't push**, because the
spec forbids pushing in this module. The owner pushes after reviewing.

**Acceptance criteria:**
- [x] Every success criterion in the spec maps to a section of the report that has evidence
- [x] `pnpm check` passes
- [x] The staged diff contains no personal address and no secret values
- [x] One local commit on `main`, not pushed

**Verification:**
- [x] `pnpm check`
- [x] Grepping `git diff --cached` for the personal address (and its domain) finds nothing

**Dependencies:** Task 8

**Files likely touched:** `spec/publish-audit-report.md`, `spec/capability-map.md`, `tasks/publish-audit-todo.md`

**Estimated scope:** XS

---

## Task 10: Owner sign-off (after the build, by the owner)

**Description:** Done as part of Task 9's commit, before the owner's review: the report ends with an empty sign-off line
(`Signed off: ____ (date)`), and the capability map's `publish-audit` row says "built 2026-MM-DD, awaiting sign-off".
After that, the owner reads the report and handles "Needs owner action". When the owner says it's signed off,
Claude fills in the sign-off line, marks the Progress row done, commits and pushes.

**Acceptance criteria:**
- [x] The report ends with the empty sign-off line, and the Progress row says "awaiting sign-off" (both by the build)
- [x] The owner has signed off, and the sign-off line is filled in (2026-11-25)

**Dependencies:** Task 9

**Files likely touched:** `spec/publish-audit-report.md`, `spec/capability-map.md` (both committed in Task 9)

**Estimated scope:** XS

---

## Checkpoint: Complete
- [x] Every success criterion in the spec is met except the owner's sign-off, which is left for the review
- [x] The final message to the owner lists the "Needs owner action" items first, then the summary
