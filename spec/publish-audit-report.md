# Publish audit report — V1

Spec: [SPEC-publish-audit.md](SPEC-publish-audit.md) · Plan: [publish-audit-plan.md](../tasks/publish-audit-plan.md) ·
Tasks: [publish-audit-todo.md](../tasks/publish-audit-todo.md)

Status: built and signed off 2026-11-25.

This report never contains a secret value or the owner's personal email address. The personal address is called
"the personal address" throughout.

## Summary

**`main` is safe to publish once the email rewrite runs.** No real secret is in the history or the tracked files, no
binary carries personal metadata, and nothing private is in the 21 deleted files or the 77 commit messages. The one
piece of personal data that must go, the personal address on every commit, comes out cleanly in the dry run.

- **Path A:** a new public repo gets `main` only, and the current repo becomes a private archive.
- **Secrets:** gitleaks v8.30.1 ran over the history (77 commits), every one of the 2,400 blobs on `main`, and the
  1,331 tracked files. It found 0 unallowed findings, and every scan exited 0. The scanner was proven with three random
  canaries, all caught. [.gitleaks.toml](../.gitleaks.toml) allows 8 exact fake values, each one used, with no path
  allowlist.
- **Metadata:** all 27 binaries, plus the SVG and the 8 images inside the EPUBs and ZIPs, are clean. Nothing was
  stripped.
- **Personal data:** the owner's name is accepted. The personal address appears only in the author and committer
  fields, and nowhere in messages or contents.
- **No-reply address:** `70279053+orhunakkan@users.noreply.github.com`.
- **Rewrite:** `git filter-repo --mailmap` in a fresh `--no-local` clone, with one mailmap line. The exact command is
  under "Email rewrite dry run". In the dry run, trees, names, dates, messages, trailers and graph shape were
  identical, and the only emails left were the no-reply address and `noreply@github.com`.
- **Side effect:** GitHub's signature on the PR #86 merge, `c7e2667b`, is dropped by the rewrite, so that commit
  loses its "Verified" badge. This can't be avoided.
- **Scanner gap, for `repo-security`:** gitleaks' default rules miss provider keys without a dedicated rule
  (ElevenLabs `sk_`, Paddle `pdl_`, Resend `re_`) when they sit under a neutral variable name. This audit covered that
  gap by hand (section 1). `repo-security` may want custom rules when it adds gitleaks to CI and pre-commit.

## Needs owner action

Nothing here blocks `go-public`, because no real secret was found, so nothing needs rotating.

1. ~~**Read this report and sign it off**~~ **Done 2026-11-25:** see "Sign-off".
2. ~~**Set your git email to the no-reply address**~~ **Done 2026-11-25:** the global `user.email` is now
   `70279053+orhunakkan@users.noreply.github.com`. The commit that adds this report was amended to that address
   before it was pushed, so it carries no personal address. The 77 audited commits still do, and `go-public`'s
   rewrite covers them.
3. ~~**Turn on GitHub's "Block command line pushes that expose my email"**~~ **Done 2026-11-25:** the setting is on.
   It refused the first push of the audit commit while that commit still carried the personal address.
4. ~~**Push the audit commit**~~ **Done 2026-11-25.**
5. **Optional, with no effect on the audit:** the local image `folio-audit-exiftool` and the pulled gitleaks and Debian
   images stay in Docker for `go-public`'s re-run. Remove them with `docker image rm` if you'd rather not keep them.

## Scope

- **Publishing path: A.** A new public `orhunakkan/agentic-library` gets `main` only. The current repo becomes a private
  archive, together with its PRs, issues, run logs, artifacts and wiki. The audit covers the commits on `main` and the
  tracked files.
- **Scanned:** `main` at `83504508ceef3a1bf00ce808cf86803cf4e3f035`, which has **77 commits**: 76 ordinary commits and
  1 merge (`c7e2667b`, PR #86). The spec says 68 and the plan says 74, because commits were added after each was
  written. The commit that adds this report is the 78th, and contains only this report, `.gitleaks.toml`,
  `tasks/publish-audit-todo.md` and `spec/capability-map.md`. `go-public` re-runs the audit at its own SHA.
- **Date:** 2026-11-25.

## Tools and commands

Nothing was installed on the machine. Both scanners run in containers, pinned by digest, with the repository mounted
read-only.

| Tool | Image | Version |
|---|---|---|
| gitleaks | `ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` | v8.30.1 |
| exiftool | local image `folio-audit-exiftool`, built from `debian@sha256:a64d9dbf633e2a2503afac76be521dc25d9b5765150b30d31a3914d4ae969cab` (`debian:stable-slim`) plus Debian's `libimage-exiftool-perl` package | 13.25 (`13.25+dfsg-1`) |
| git-filter-repo | installed by the owner with pacman | `c1511bf3728f` |

There is no official exiftool image, so the audit builds one from the official Debian image and Debian's signed package.
The build file, to rebuild it:

```dockerfile
FROM debian@sha256:a64d9dbf633e2a2503afac76be521dc25d9b5765150b30d31a3914d4ae969cab
RUN apt-get update && apt-get install -y --no-install-recommends libimage-exiftool-perl unzip && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["exiftool"]
```

The gitleaks commands that ran. `$SCRATCH` is the session scratchpad. The three `GIT_CONFIG_*` variables mark the
read-only mount as a safe directory, so git inside the container doesn't refuse it for its ownership.

```sh
GL=ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
SAFE="-e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=*"

# 1. History: every commit on main (the diffs, so files deleted since are included)
docker run --rm $SAFE --user "$(id -u):$(id -g)" -v "$PWD:/repo:ro" -v "$SCRATCH:/out" $GL \
  git /repo --log-opts=main --config /repo/.gitleaks.toml --redact --report-format json --report-path /out/history.json

# 2. Tracked files: export main's tree first, so untracked and ignored files (.env, node_modules) aren't scanned
git archive main | tar -x -C "$SCRATCH/tree"
docker run --rm --user "$(id -u):$(id -g)" -v "$SCRATCH/tree:/repo:ro" -v "$SCRATCH:/out" $GL \
  dir /repo --config /repo/.gitleaks.toml --redact --report-format json --report-path /out/tree.json
```

The baseline runs were the same commands without `--config`, so they used the default rules and no allowlist.

## 1. Secrets in history

**Result: 0 unallowed findings. No real secret was found.**

| Scan | What it covers | Exit code | Findings with config | Findings, default rules only |
|---|---|---|---|---|
| `gitleaks git --log-opts=main` | the diffs of every commit on `main`, so deleted files such as `SPEC.md`, `scripts/issue-loop/*` and `docs/agents/*` are included | 0 | 0 | 16 (all allowlisted fakes) |
| `gitleaks dir` over every blob on `main` | all 2,400 file versions reachable from `main`, each written to the scratchpad from `git rev-list --objects main` | 0 | 0 | 29 (other versions of the same fakes) |

gitleaks reported "75 commits scanned" against 77 on `main`. The difference is expected: `git log -p` gives a merge no
diff, and two commits only delete files (`77fb8600` removes `SPEC.md`, `1e7154d5` removes the agent-skills docs and the
issue loop), so they add nothing to scan. Whatever they deleted was scanned in the commit that added it. The one merge,
`c7e2667b`, has an empty combined diff, so it brings in no content of its own. The all-blobs scan covers it anyway.

**Hand check for keys without a dedicated rule** (see the limitation in section 3). Every blob on `main` was searched
for the prefixes `sk-ant-`, `sk-proj-`, `sk_`, `pdl_`, `re_`, `whsec_`, `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`,
`github_pat_`, `folio_at_`, `AKIA`, `xox?-`, `AIza` and `-----BEGIN … PRIVATE KEY-----`. Random-looking parts were
masked before anything was printed. That turned up 42 distinct values in 20 files, all of them tests, test helpers
(`src/server/testing/`, `tests/e2e/support/`), `playwright.config.ts` or `spec/SPEC-publish-audit.md`. Every one is
fake:

- They spell words, as in `sk-ant-api03-a-key-that-must-not-be-logged`, `pdl_ntfset_theoldsecret` and
  `re_from_the_file`.
- Or they're counting sequences, as in `sk-proj-0123456789abcdefghij` and `pdl_ntfset_01abcdefghij_…`.
- Or they're filler, as in `sk-ant-test-valid-xxxxxxxxxxxxxxxx0000`.
- Two needed a closer look and were checked without printing them:
  - The `whsec_` value in `mail/signature.test.ts` is the Svix docs example (see section 4).
  - The `ghp_` value in `config.test.ts` has a 29-character, all-lowercase body. A GitHub classic token is `ghp_` plus
    exactly 36 mixed-case characters, so this can't be a valid token. The test uses it to check that classic tokens
    are refused.

There were no AWS, Slack, Google, private-key or `folio_at_` hits at all.

## 2. Secrets in the tracked files

**Result: 0 unallowed findings.** `gitleaks dir` over `git archive main`, which is exactly the 1,331 tracked files and
nothing untracked or ignored: exit code 0, 0 findings with the config, and 16 with the default rules only (all
allowlisted fakes, the same values as in history).

## 3. The scanner works: canary check

The canaries went into a `--no-local` scratch clone of `main`, in one commit. Each was generated at random, with no
`test` or `fake` in its value, and none was printed or written down. The clone was deleted afterwards.

| Canary | Where | Caught by (real `.gitleaks.toml`) |
|---|---|---|
| GitHub classic token (`ghp_` + 36 random characters) | a new file, `src/server/canary-new-file.ts` | `github-pat`, history and tree |
| ElevenLabs-shaped key (`sk_` + 48 random hex characters), as `const key = …` | `src/server/redact.test.ts`, next to the fake keys | `generic-api-key`, history and tree |
| Paddle-shaped sandbox key (`pdl_sdbx_apikey_` + random parts), as `PADDLE_API_KEY: …` | `src/server/redact.test.ts`, next to the fake keys | `generic-api-key`, history and tree |

**Result: all 3 caught, in both modes.** The 16 allowed fakes in the same files stayed quiet, so the allowlist lets
through only the exact fake values and nothing near them.

**Scanner limitation found along the way.** A first try put the two test-file canaries in variables named `leaked` and
`leakedPaddle`. Neither was reported, with the real config or with the default rules alone. `generic-api-key` only
fires when the name or nearby text contains a keyword such as `key`, `token` or `secret`, and there is no
dedicated rule for ElevenLabs or Paddle keys. So gitleaks misses a provider key without a dedicated rule when it sits
under a neutral name. This is a gap in gitleaks' default rules, not in this config. `repo-security` can add custom rules
for the `sk_`, `pdl_` and `re_` prefixes if it wants to close it. This audit covers that gap by hand: section 1 greps
the tracked files and every blob on `main` for those prefixes.

## 4. Allowlist

[.gitleaks.toml](../.gitleaks.toml) extends the default rules and allows **8 exact, anchored values** (`^…$`, matched
against the extracted secret). There is no path or directory allowlist.

The allowlist was built from what gitleaks found. The baseline run, with the default rules and no allowlist, reported
16 findings in history and 16 in the tracked files: the same 16 values. All of them were added by `fd2c187e`, the first
commit, and every one sits in a test file or in `src/server/testing/`. Each was sorted as fake:

| Entry | Matches | Why it's fake | Findings it covers |
|---|---|---|---|
| `^(test\|live)_0123456789(abcdef)?$` | Paddle client tokens in `config.test.ts`, `billing/paddle-api.test.ts`, `testing/paddle.ts` | counting sequence | 6 |
| `^pdl_(sdbx\|live)_apikey_0123456789abcdefghij$` | Paddle API keys in `config.test.ts` | counting sequence | 3 |
| `^pdl_sdbx_apikey_01abcdefghijklmnopqrstuv_WxYz0123456789abcdefgh_AbC$` | Paddle-shaped key in `redact.test.ts` | counting sequence | 1 |
| `^sk_0123456789abcdef0123456789abcdef(0123456789abcdef)?$` | ElevenLabs-shaped keys in `speech/elevenlabs.test.ts`, `redact.test.ts` | repeated `0-9a-f` | 2 |
| `^re_test_0123456789abcdef$` | Resend key in `config.test.ts` | counting sequence | 1 |
| `^whsec_plJ3nmyCDGBKInavdOK15jsl$` | webhook secret in `mail/signature.test.ts` | the example from Svix's public "verifying payloads" docs. Checked: its HMAC over the docs' message id, timestamp and body reproduces the docs' signature, which the test also uses | 1 |
| `^Qm9vay1ib29rLWJvb2stYm9vay1ib29rLWJvb2stYm9v$` | mailed-link token in `redact.test.ts` | base64 of "Book-book-book-…". Folio's own tokens are 43-character base64url, so this can't be one | 1 |
| `^ghp_0123456789abcdefghijABCDEFGHIJ012345$` | GitHub token shape in `redact.test.ts` | counting sequence | 1 |

**Every entry is used.** Each entry was removed in turn and both scans re-run: the count went up by exactly the number
in the last column, which totals 16. With all 8 entries, both scans report 0.

**Differences from the spec's sample allowlist.** The sample's `sk-ant-api03-…` and `sk-proj-…` entries are left out.
The Anthropic and OpenAI fakes in the tests, such as `sk-ant-api03-this-is-a-fake-key-0000`, don't match gitleaks'
Anthropic or OpenAI rules, so they were never reported, and an unused entry would only widen the allowlist. The sample's
`pdl_…test…` pattern is replaced by exact values. The Paddle entries stay even though `billing-removal` deletes those
tests, because the history scan still sees them.

## 5. Personal data

**Result: the only personal data is the owner's name, which is accepted, and the personal address in the commit
metadata, which the email rewrite removes.**

**Commit metadata** (`git log main --format='%an <%ae>%n%cn <%ce>' | sort | uniq -c`):

| Identity | Count | Action |
|---|---|---|
| author `Orhun Akkan <the personal address>` | 77 of 77 | email rewritten to the no-reply address (see "Email rewrite dry run") |
| committer `Orhun Akkan <the personal address>` | 76 of 77 | email rewritten to the no-reply address |
| committer `GitHub <noreply@github.com>` | 1 (`c7e2667b`, the merge of PR #86) | left as it is, accepted as public |
| trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` | 74 commits | accepted as public: a vendor no-reply address |

**The personal address appears nowhere else.** It's in 0 commit messages and 0 of the 2,400 blobs on `main`. Its domain
is also in 0 of either. These counts came from a variable read out of `git log`, so the address was never typed or
printed.

**Email addresses in the tracked files.** The spec's grep found these, outside `example.com`, `example.org`,
`folio.test` and `resend.dev`:

| Address | Where | Verdict |
|---|---|---|
| `no-reply@agenticlibrary.app` | config and mail tests, `MAIL_FROM` examples | accepted as public: the site's own sender |
| `70279053+orhunakkan@users.noreply.github.com` | spec and task files | accepted as public: the GitHub no-reply address |
| `noreply@github.com` | spec and task files | accepted as public |
| `Ann@Example.com`, `ann@EXAMPLE.com`, `Family@Example.com`, `ann@exämple.com`, `ann@example..com` and similar | email-parsing tests | fine: `example.com` variants and invalid-on-purpose inputs |
| `a@b.co`, `c@d.co`, `p@a.test`, `cy@example.net`, `x-y_z@my-host.example`, `ann.smith@mail.example.co.uk` | email-parsing, mail and SSRF tests | fine: test inputs on reserved or throwaway domains |
| `user@github.com` | `github-url.test.ts`, as a URL userinfo case (`https://user@github.com/a/b`) | fine: test input, not a mailbox |

**Names.** "Orhun Akkan" appears as the commit author and on the Terms, Privacy page and footer. The capability map
accepts this. All other names are fixtures: "Ada Tester", "Ada Fixture", "Lin Tester", "Ann", "Tester Press".

**Phone numbers and postal addresses:** none. A phone-number grep over the tracked files found nothing.

## 6. Infrastructure details

**Result: nothing grants access. Everything found is accepted as public** and listed in "Accepted as public".

| Detail | Where | Verdict |
|---|---|---|
| `sudo -n /usr/local/bin/agentic-library-deploy dev "$GITHUB_SHA"` and `… prod "$SHA"` | `.github/workflows/ci.yml:178`, `.github/workflows/deploy-prod.yml:33`, and specs | accepted. `repo-security` moves the call into the server-side poller |
| `runs-on: ${{ vars.CI_RUNNER }}`, the runner name `LINUX-LAPTOP` | both workflows (the variable), and the map and specs (the name) | accepted. `repo-security` removes the runner and the variable |
| `agenticlibrary.app` (87 mentions), `dev.agenticlibrary.app` (15) | code, tests and specs | accepted: public domains |
| `/var/lib/agentic-library/dev-audiobooks`, `/opt/agentic-library/voices`, `/srv/voices`, `/var/run/postgresql`, `/run/pg` | config and test fixtures | accepted: example storage and socket paths that hint at the server layout but grant nothing |
| `/run/creds/{kek,kek_previous,github_token,resend_api_key,resend_webhook_secret,paddle_api_key,paddle_webhook_secret}` | `config.test.ts`, as fake `CREDENTIALS_DIRECTORY` file names | accepted: the systemd credential file names are documented in `SPEC-contributor-docs.md` anyway. There are no values |
| Deploy poller `scripts/deploy/poll.ts` with `folio-deploy-poll.service` and `.timer` | `SPEC-repo-security.md`, `SPEC-go-public.md` (planned, not built yet) | accepted ahead of time. `repo-security` adds them, and `go-public`'s re-run checks the files as built |
| IPv4 addresses | SSRF tests: range boundaries (`10.0.0.0`, `169.254.169.254` …), documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`), `8.8.8.8`, and the old `example.com` address `93.184.216.34` | fine: no server address |
| SSH keys, `known_hosts`, `.ssh/`, tunnels (`tailscale`, `ngrok`, `cloudflared`) | none | — |

The commit messages hold no URLs, no hostnames and no server paths (see section 9).

## 7. File metadata

**Result: no personal metadata in any tracked binary. Nothing was stripped and nothing needs stripping.**

How it was checked:

- `exiftool -G1 -a -s` ran on every tracked image, audio file, PDF, EPUB and ZIP, plus `public/favicon.svg`.
- Every tag group beyond the file system's own was read. The tag names searched for were author, creator, artist,
  copyright, GPS, make, model, serial, software, history, owner, producer, comment, description, title, publisher,
  rights, keywords, device, document ID, and paths such as `/home` or `C:\`.
- Each EPUB and ZIP was unpacked into the scratchpad. Its OPF or `book.toml` was read, and exiftool ran on the 8
  images inside. None of the archives has a ZIP comment.
- All 28 files and their unpacked contents were searched byte by byte. The personal address, its domain, `orhun`,
  `Orhun`, `Akkan`, `/home/`, `/Users/`, `C:\Users` and `LINUX-LAPTOP` each appear in **0** files.

No image has an EXIF, XMP, IPTC or GPS block. The only embedded data in the JPEGs is a generic "sRGB, Google Inc.
2016" colour profile, which is what Chrome and Skia write.

| File | Metadata found | Verdict |
|---|---|---|
| `public/apple-touch-icon.png` | PNG header only | no personal metadata |
| `public/home/pride-and-prejudice.jpg` | JFIF header only | no personal metadata |
| `public/icons/icon-192.png` | PNG header only | no personal metadata |
| `public/icons/icon-512.png` | PNG header only | no personal metadata |
| `public/favicon.svg` (extra, not in the 27) | `<title>Folio</title>` | no personal metadata |
| `tests/e2e/content/covers/fixture-code-book.jpg` | sRGB colour profile (Google Inc. 2016) | no personal metadata |
| `tests/e2e/content/covers/pride-and-prejudice.jpg` | JFIF header only | no personal metadata |
| `tests/e2e/content/images/fixture-figure-book/6b35c3f38818.png` | PNG header only | no personal metadata |
| `tests/e2e/fixtures/code-book/fixture-code-book.epub` | OPF: title "A Small Book of Code", creator "Ada Tester". Inner cover: sRGB profile | no personal metadata |
| `tests/e2e/fixtures/code-book/fixture-figure-book.epub` | OPF: "A Small Book of Figures", "Ada Tester". Inner PNG: header only | no personal metadata |
| `tests/e2e/fixtures/imports/field-notes.epub` | OPF: "Field Notes", "Ada Tester", publisher "Tester Press", date 2019-06-01, ISBN 978-0-14-143951-8 (a real, public Penguin Classics ISBN, used as a fixture). Inner cover: sRGB profile | no personal metadata |
| `tests/e2e/fixtures/imports/figures.epub` | OPF: "Harbour Pictures", "Ada Tester". 4 inner images: header or sRGB profile only | no personal metadata |
| `tests/e2e/fixtures/imports/figures-handbook.zip` | `book.toml`: "Flow Guide", authors "Lin Tester". Inner PNG: header only | no personal metadata |
| `tests/e2e/fixtures/imports/team-handbook.zip` | `book.toml`: "Team Handbook", authors "Lin Tester" | no personal metadata |
| `tests/e2e/fixtures/imports/pdf-handbook.pdf` | Title "The Lantern Handbook", Creator "Chromium", Producer "Skia/PDF m156", dates fixed at 2026-01-01 | no personal metadata |
| `tests/e2e/fixtures/imports/pdf-paper.pdf` | Creator "Chromium", Producer "Skia/PDF m156", dates fixed at 2026-01-01 | no personal metadata |
| `tests/e2e/fixtures/imports/pdf-scanned.pdf` | Creator "Chromium", Producer "Skia/PDF m156", dates fixed at 2026-01-01 | no personal metadata |
| `tests/fixtures/audio/chapter-1.mp3` | ID3: "The Arrival", album "The Fixture Audiobook", artist "Ada Fixture", encoder Lavf63.1.102 | no personal metadata |
| `tests/fixtures/audio/chapter-2.mp3` | ID3: "The Dinner", same album, artist and encoder | no personal metadata |
| `tests/fixtures/audio/chapter-3.mp3` | ID3: "The Departure", same album, artist and encoder | no personal metadata |
| `tests/fixtures/audio/drm.m4b` | MP4: "The Fixture Audiobook", "Ada Fixture", Lavf63.1.102, chapter list | no personal metadata |
| `tests/fixtures/audio/three-chapters.m4b` | MP4: same as `drm.m4b` | no personal metadata |
| `tests/fixtures/audio/truncated.m4b` | QuickTime header only (deliberately truncated) | no personal metadata |
| `tests/fixtures/images/cover.jpg` | sRGB colour profile (Google Inc. 2016) | no personal metadata |
| `tests/fixtures/images/huge.jpg` | sRGB colour profile (Google Inc. 2016) | no personal metadata |
| `tests/fixtures/images/not-an-image.jpg` | none (not an image, on purpose) | no personal metadata |
| `tests/fixtures/images/tiny.png` | PNG header only | no personal metadata |
| `tests/fixtures/images/wide.png` | PNG header only | no personal metadata |

That's 27 rows for the spec's file types (12 images, 6 audio files, 3 PDFs, 4 EPUBs and 2 ZIPs), matching
`git ls-files '*.jpg' '*.png' '*.mp3' '*.m4b' '*.pdf' '*.epub' '*.zip' | wc -l` = 27, plus the SVG.

The exiftool command that ran (the spec's, with `*.zip` and `*.svg` added):

```sh
git ls-files -z '*.jpg' '*.png' '*.mp3' '*.m4b' '*.pdf' '*.epub' '*.zip' '*.svg' | xargs -0 \
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w:ro" -w /w folio-audit-exiftool -G1 -a -s
```

## 8. Deleted files

**Result: nothing private or embarrassing. One minor detail is accepted:** the owner's local home path.

`git log main --diff-filter=D --name-only --format= | sort -u` lists 21 paths. Each was read from the parent of the
commit that deleted it, with `git show <commit>^:<path>`. Agent settings, prompts, scripts and docs were read in full.
For the 6 source files, the comments, string literals and URLs were read, and the logic was skimmed. Every version of
every file also went through the history and all-blobs gitleaks scans (section 1).

| Path | Deleted in | Note |
|---|---|---|
| `CLAUDE.md` | `1e7154d5` | nothing notable: the old agent notes (issue tracker, labels, tests, main-only workflow). A new `CLAUDE.md` was added later in `c3eae5d3` |
| `CODING_STANDARDS.md` | `1e7154d5` | nothing notable: review-time judgement calls |
| `GLOSSARY.md` | `1e7154d5` | nothing notable: domain terms |
| `docs/adr/0001-books-module-owns-reading-stores-own-storage.md` | `1e7154d5` | nothing notable. It refers to issue #70, which stays in the archive |
| `docs/adr/0002-player-owns-both-sources-and-the-sleep-timer.md` | `1e7154d5` | nothing notable |
| `docs/agents/domain.md` | `1e7154d5` | nothing notable: generic skill instructions |
| `docs/agents/issue-loop.md` | `1e7154d5` | **minor:** it names the owner's local paths, `~/.local/state/issue-loop/agentic-library/` and `~/.claude/projects/-home-orhunakkan-agentic-library/`. These reveal the Linux username, which is the same as the public GitHub handle, so it's accepted. It also says the loop runs in tmux on the owner's computer |
| `docs/agents/issue-tracker.md` | `1e7154d5` | nothing notable: `gh` usage conventions |
| `docs/agents/triage-labels.md` | `1e7154d5` | nothing notable |
| `scripts/issue-loop.sh` | `1e7154d5` | nothing notable: tmux, `systemd-inhibit`, `claude -p` runs with `--permission-mode dontAsk` |
| `scripts/issue-loop/build-prompt.md` | `1e7154d5` | nothing notable |
| `scripts/issue-loop/build-settings.json` | `1e7154d5` | nothing notable: the agent's allow list (`pnpm`, read-only `git`, `gh issue`) and deny list (push, pull, reset, `gh pr`). No paths, tokens or hosts |
| `scripts/issue-loop/ci-local.sh` | `1e7154d5` | nothing notable. Its default `postgres://postgres:postgres@127.0.0.1:5432/agentic_test` is the stock credential of a throwaway local test database, the same one CI's Postgres service and `tests/test-databases.test.ts` use |
| `scripts/issue-loop/retro-prompt.md` | `1e7154d5` | nothing notable |
| `scripts/issue-loop/retro-settings.json` | `1e7154d5` | nothing notable: a read-only allow list |
| `SPEC.md` | `77fb8600` | nothing notable: the approved spec for the OpenAI-key feature (shipped in `cc65a113`). It has no key values |
| `src/client/features/read-aloud/use-read-aloud.ts` | `9e0cd325` | nothing notable: replaced by the player module |
| `src/server/book-ref/book.ts` | `473bdb8b` | nothing notable: moved into `books/` |
| `src/server/book-ref/book-ref.db.test.ts` | `473bdb8b` | nothing notable: fixtures such as "Jane Austen", "Field Notes", `https://news.test/a` |
| `src/server/private-reading.ts` | `473bdb8b` | nothing notable |
| `src/server/private-reading.db.test.ts` | `473bdb8b` | nothing notable |

The home path also appears in two tracked specs, as the clone path in the commands of
[SPEC-publish-audit.md](SPEC-publish-audit.md) and in [SPEC-go-public.md](SPEC-go-public.md). It's accepted in the
same way.

## 9. Commit messages

**Result: nothing private.** All 77 subjects and bodies were read, from `fd2c187e` to `83504508`.

- No message contains an email address apart from the `Co-Authored-By: … <noreply@anthropic.com>` trailers. There are
  no URLs, hostnames, server paths or secrets. The `@` hits are npm package names (`@paddle/paddle-js`,
  `@tanstack/react-start`, `@vitest/browser-playwright`) and comment directives (`@ts-expect-error`, `@vite-ignore`).
- **`fd2c187e`, the root commit, has the subject "..."** and brings in the whole tree at once, so the history before
  November isn't on `main` at all. That's not private, just uninformative. It's left as it is, because the rewrite keeps
  messages byte for byte.
- `c7e2667b` is the merge of PR #86, from branch `orhunakkan/chore/agent-skills-setup`. Its committer is
  `GitHub <noreply@github.com>`. Both are accepted.
- 52 commits refer to `#N` PRs and issues (#70, #86–#162). They're accepted, and stay unchanged.
- The messages describe the product's history, such as Paddle billing, Pro plans, the issue loop and the AI-agent
  workflow. That's public by design once the code is.

## Email rewrite dry run

**Result: passed.** In a scratch clone, the rewrite changed the author and committer emails and nothing else. No trace
of the personal address is left.

**What `go-public` runs**, as its last step before the first push, in a fresh clone and never in the working repo.
The personal address is never typed: it's read from the root commit's author field into a variable, written only to
the mailmap file on disk, and never printed, committed or pasted into a report.

```sh
REPO=/home/orhunakkan/agentic-library
SCRATCH=$(mktemp -d)
PERSONAL=$(git -C "$REPO" log -1 --format=%ae "$(git -C "$REPO" rev-list --max-parents=0 main)")
git clone --no-local --single-branch --branch main "$REPO" "$SCRATCH/rewrite"
( umask 077; printf 'Orhun Akkan <70279053+orhunakkan@users.noreply.github.com> <%s>\n' "$PERSONAL" > "$SCRATCH/mailmap" )
git -C "$SCRATCH/rewrite" filter-repo --mailmap "$SCRATCH/mailmap"

# Proof: everything but the emails is unchanged
FMT='%T%x00%an%x00%ad%x00%cn%x00%cd%x00%B%x00%(trailers)'
git -C "$REPO" log main --date=raw --format="$FMT" > "$SCRATCH/before"
git -C "$SCRATCH/rewrite" log main --date=raw --format="$FMT" > "$SCRATCH/after"
cmp "$SCRATCH/before" "$SCRATCH/after"                                   # must print nothing
git -C "$SCRATCH/rewrite" log main --format='%ae%n%ce' | sort | uniq -c    # only the no-reply address and noreply@github.com
git -C "$SCRATCH/rewrite" cat-file --batch-all-objects --batch | grep -caiF "$PERSONAL" || true   # must print 0 (grep exits 1 on no match)
rm "$SCRATCH/mailmap"; unset PERSONAL
```

There's one mailmap line. The `GitHub <noreply@github.com>` committer gets no line, so it stays as it is (decided
2026-11-25). When run with only a mailmap, filter-repo removes the clone's `origin` remote and leaves `main` as the
only ref. That's the shape a first push wants.

**What the dry run showed**, at `83504508`:

| Check | Result |
|---|---|
| `cmp` of `%T %an %ad %cn %cd %B`, the spec's format | identical |
| `cmp` with raw dates (timezones included) and trailers | identical |
| commit count before and after | 77 and 77 |
| graph shape: each commit's tree and its parents' trees, the merge's 2 parents included | identical |
| `log --format='%ae%n%ce' \| sort \| uniq -c` | `70279053+orhunakkan@users.noreply.github.com` 153 times (77 authors, 76 committers), `noreply@github.com` once |
| the personal address and its domain in `git log --all -p --format=fuller` | 0 and 0 |
| … in `git cat-file -p` on every commit | 0 and 0 |
| … in all 3,444 objects (`cat-file --batch-all-objects --batch`) | 0 and 0 |
| … in any file under the clone, `.git` and packs included | 0 and 0 |
| refs and remotes in the clone | `refs/heads/main` only, and no remotes |

**One side effect: a signature is dropped.** `c7e2667b`, the PR #86 merge made on GitHub, carries GitHub's web-flow
signature (key `B5690EEEBB952194`). filter-repo drops it, and it has to: the rewritten commit has a new SHA and new
parents, so the old signature could never verify again. On the new repo, that one commit has no "Verified" badge. None
of the other 76 commits was signed. This is unavoidable with any rewrite, and is recorded here so it isn't a surprise.

The clone, the mailmap and the before/after listings were deleted after the run.

## Accepted as public

Each of these is published on purpose. None of them grants access to anything.

| Item | Why it's fine |
|---|---|
| The owner's name, "Orhun Akkan", as commit author and committer, and on the Terms, Privacy page and footer | the capability map's decision: the operator is named |
| The author and committer email `70279053+orhunakkan@users.noreply.github.com`, after the rewrite | GitHub's no-reply address, made for this purpose |
| The committer `GitHub <noreply@github.com>` on one commit (`c7e2667b`) | GitHub's own address, not personal data (decided 2026-11-25) |
| `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` on 74 commits | a vendor no-reply address |
| `agenticlibrary.app`, `dev.agenticlibrary.app` and the sender `no-reply@agenticlibrary.app` | public domains and the site's own sender |
| `sudo -n /usr/local/bin/agentic-library-deploy <dev\|prod> <sha>` in both workflows, and later in the poller | it names the deploy script but grants nothing. Only the server's own sudo rule lets it run |
| The deploy poller's files `scripts/deploy/*`, its systemd units `folio-deploy-poll.service` and `.timer`, and its install path | planned by `repo-security`, which adds them later. `go-public`'s re-run checks the files as built |
| The owner's local home path (`/home/orhunakkan/…`, `-home-orhunakkan-agentic-library`) in two specs and the deleted `docs/agents/issue-loop.md` | the Linux username is the same as the public GitHub handle, so it reveals nothing new |
| The runner name `LINUX-LAPTOP` and the variable `CI_RUNNER` | in the specs and workflows. `repo-security` removes the runner |
| Example server paths in tests: `/var/lib/agentic-library/…`, `/opt/agentic-library/voices`, `/run/creds/<name>` | file and directory names only, no values |
| `#N` PR and issue references in commit messages: 52 of the 77 commits, citing 42 distinct numbers (the spec's "61" was counted differently) | decided 2026-11-25: left as they are, even though in the new repo they point at the wrong numbers |
| The 8 fake test keys in `.gitleaks.toml`, and the other fake keys in tests | fake by construction (section 4) |
| The ISBN 978-0-14-143951-8 in `field-notes.epub` | the public ISBN of a published book, used as a fixture |

## Success criteria

The spec's criteria, each with where its evidence is.

| Criterion | Status | Evidence |
|---|---|---|
| gitleaks over all commits on `main` reports 0 unallowed findings | met (77 commits, not 68) | section 1 |
| gitleaks over the tracked files reports 0 unallowed findings | met | section 2 |
| The canary check is caught, and the report shows it | met: 3 of 3 caught | section 3 |
| Every allowlist entry is a value or narrow pattern, and matches an existing fake key | met: 8 exact values, each shown to be used | section 4 |
| Every tracked image, audio, PDF, EPUB and ZIP file is listed with a verdict | met: 27 rows plus the SVG | section 7 |
| The deleted files and all commit messages are reviewed, with notable items listed | met: 21 files, 77 messages | sections 8 and 9 |
| An "Accepted as public" list covering the owner's name, the domains, the deploy script path, the poller's install path and units, the no-reply address and the `#N` references | met. The poller items are accepted ahead of time, because `repo-security` hasn't built them yet | "Accepted as public" |
| Email rewrite dry run: `cmp` is identical, only the no-reply address and `noreply@github.com` are left, and the personal address is in no log, metadata or object | met | "Email rewrite dry run" |
| The report records path A, the no-reply address and the exact rewrite command | met | "Scope", "Summary", "Email rewrite dry run" |
| The owner has read the report and signed it off | met, 2026-11-25 | "Sign-off" |

## Sign-off

Signed off: Orhun Akkan (2026-11-25)

## Re-run before go-public — 2026-11-26

**Result: passed. 0 unallowed findings, the canaries are caught, and nothing new needs accepting.**

- **Scanned:** `main` at `7c31cf4d7d9a572bbc1c6b2a5af974d26ce27c49`, 106 commits, 28 of them after the sign-off commit
  `89f46c8d`. CI on that SHA is green on all six jobs, on GitHub-hosted runners.
- **Secrets:** gitleaks v8.30.1 (same digest, real `.gitleaks.toml`) over the history (104 commits scanned), the 1,261
  tracked files, and all 2,877 blobs reachable from `main`: 0 findings each, exit 0.
- **Canaries:** the same three shapes as section 3, freshly random, in a `--no-local` scratch clone: all 3 caught
  (`github-pat` once, `generic-api-key` twice). The clone was deleted.
- **Hand check of new key-shaped strings** since the sign-off: `sk-ant-test-valid-xxxx…1111`, `pdl_sdbx_apikey_0123…`,
  `pdl_ntfset_0123…`, and the GitHub setting names `require_code_owner_review` and `require_last_push_approval`. All
  fake or not keys.
- **Identities:** the personal address on 153 author and committer fields of the 78 commits up to the sign-off, the
  no-reply address on 58, and `GitHub <noreply@github.com>` once. The 28 commits since the sign-off carry only the
  no-reply address. The personal address and its domain are in 0 commit messages and 0 tracked files.
- **Email addresses in the tracked files:** only those already accepted in section 5, plus `noreply@anthropic.com` in
  the contributor docs (accepted as a vendor no-reply address).
- **Commit messages since the sign-off:** all 28 read. No address but the `Co-Authored-By` trailers, and no URLs,
  hostnames, server paths or secrets. The `@` hits are npm package names.
- **Files deleted since the sign-off:** 141, in two commits. `39a391f2` removes the Playwright end-to-end suite and
  `5fd5ead1` removes billing and plans. Every one was in the tree at the sign-off, so it went through that audit's
  scans. Their last versions were searched again for home paths, the runner and server names, IP addresses and hosts.
  They hold only `localhost`, `127.0.0.1`, documentation addresses, Paddle's public and `.test` hosts, and public
  sites.
- **Binary files added or changed since the sign-off:** none.
- **The deploy poller as built** (`scripts/deploy/*`): it names the deploy script, the systemd credential name
  `github_token` and the `folio-deploy` user. This is accepted ahead of time in "Accepted as public".
