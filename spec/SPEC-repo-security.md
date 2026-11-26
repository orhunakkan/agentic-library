# Spec: repo-security — V1

Status: approved (2026-11-25)

Module of [capability-map.md](capability-map.md). Depends on `publish-audit`, which provides `.gitleaks.toml`.
`contributor-docs` depends on this module, and `go-public` applies the GitHub settings it defines.

## Objective

Make the repository safe to open to strangers. Once it is public, anyone can fork it, open a PR, read every CI log and
download every artifact. None of that may give them a way onto the server that hosts dev and prod, a credential, or a
way to change `main`.

**Who it's for:** the owner, as the only maintainer. Contributors are affected too: their PRs must run the full test
suite without help.

## Why the self-hosted runner goes

The map planned to keep the self-hosted runner and harden the `if:` fork guard in [ci.yml](../.github/workflows/ci.yml).
That guard isn't a security boundary. For `pull_request` events, GitHub runs the workflow file **from the PR's own
merge commit**, so a fork PR can delete the guard, or add a job with `runs-on: self-hosted`, and its code runs on the
runner. A test in the repo can't prevent this, because the fork can edit the test as well.

The runner `LINUX-LAPTOP` (label `mint-laptop`) is the "mint server" that hosts dev and prod. Its user can run
`sudo -n /usr/local/bin/agentic-library-deploy`, and once sign-up is open it holds other people's data. GitHub
advises against self-hosted runners on public repositories for exactly this reason.

**Decided (2026-11-25): no self-hosted runners for this repository, including for deploys.** Every CI job runs on
GitHub-hosted runners, which cost nothing for public repositories. The server stops taking jobs from GitHub. It pulls
deploy requests instead (see [Deploys without a runner](#deploys-without-a-runner)).

This reverses the map's "Moving all CI to GitHub-hosted runners: rejected for V1", and the map has been updated.

## What changes

### 1. CI on GitHub-hosted runners

[ci.yml](../.github/workflows/ci.yml) keeps its jobs (checks, component, db) and their order. The e2e job was removed on
2026-11-26 along with the Playwright suite, and `pnpm build` moved into checks. Only these change:

- `runs-on: ubuntu-24.04` on every job, replacing `${{ vars.CI_RUNNER }}`. The label is pinned so runs are
  reproducible, and moving to a newer image is a deliberate change.
- The `if:` fork guards are removed. Every PR, including PRs from forks and from Dependabot, runs the full suite, because
  no job has anything to steal: there are no secrets, the token is read-only, and the runner is thrown away after the job.
- `actions/checkout` gets `persist-credentials: false` everywhere.
- Every `uses:` is pinned to a full 40-character commit SHA, with the version in a trailing comment, which Dependabot
  keeps up to date.
- The `container:` and `services:` images (`mcr.microsoft.com/playwright`, `postgres`) are pinned by `@sha256:`
  digest, with the tag in a comment. They are still bumped by hand together with the `playwright` package (Vitest's
  browser provider), as they are today.
- `deploy-dev` becomes `request-dev-deploy`. It runs on `push` to `main` only, after `db`, and its only write
  permission is `deployments: write`. It creates a GitHub Deployment for environment `dev` at `$GITHUB_SHA`. It
  doesn't deploy anything itself.
- Two new jobs, which can run in parallel with `checks`: **Secrets scan** (gitleaks) and **Workflow lint** (zizmor). See
  section 4.

[deploy-prod.yml](../.github/workflows/deploy-prod.yml) keeps `workflow_dispatch` and its SHA validation, and also:

- runs on `ubuntu-24.04`;
- guards on `github.actor == github.repository_owner && github.triggering_actor == github.repository_owner`, so a
  re-run started by anyone else is also refused;
- checks that the SHA is on `main`, that CI succeeded for it, and that a `dev` deployment of it succeeded. If not, it
  fails with the reason;
- then creates a GitHub Deployment for `production` at that SHA (`deployments: write`). The server does the rest.

Example of the pinned style (the SHAs are filled in during implementation):

```yaml
      - uses: actions/checkout@<40-hex sha> # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
```

### 2. Deploys without a runner

**Decided: the server polls.** No inbound access and no credentials in GitHub.

- A small script, `scripts/deploy/poll.ts`, runs on the server from a systemd timer every 30 seconds. It reads GitHub
  Deployments for `dev` and `production` that don't yet have a final status.
- **The server is the security boundary, not the workflow.** Before it runs the deploy script for SHA `S` in
  environment `E`, the poller checks for itself that:
  1. `S` is 40 lowercase hex characters;
  2. `S` is `main` or an ancestor of `main` (compare API: `identical` or `behind`);
  3. a `ci.yml` run triggered by `push` on `main` with head `S` concluded `success`;
  4. for `production` only, a `dev` deployment of `S` has a `success` status.

  If any check fails, the poller marks the deployment `failure` with the reason and doesn't run the deploy script. So a
  stolen token, a rogue workflow or a hand-made API call can at most redeploy a commit that is already on `main`,
  passed CI and was tested on dev.
- If several `dev` requests are waiting, only the newest is deployed, and the older ones are marked `inactive`.
- Statuses go back to GitHub: `in_progress`, then `success` or `failure`. The description is short and never includes
  logs, paths or environment values. Full logs stay in the server's journal.
- Then it runs `sudo -n /usr/local/bin/agentic-library-deploy <dev|prod> <sha>`, as the runner does today. The deploy
  script itself doesn't change.
- **Server token:** a fine-grained personal access token for this one repository, with Actions: read, Contents: read,
  Deployments: read and write, and Metadata: read. It is stored in a root-only file on the server and never in GitHub.
  If it expires, deploys stop, which fails safe, and the poller logs why.
- **The installed copy isn't updated automatically.** The owner copies `scripts/deploy/*` to the server by hand after
  reviewing it, so a commit on `main` can't change what runs with deploy rights until the owner installs it.
- The decision logic, `scripts/deploy/decide.ts`, is a pure function with no I/O, so it is unit tested. `poll.ts` does
  the HTTP calls and the subprocess call, and has `--dry-run`, which prints what it would do and changes nothing.

*Rejected:* pushing to the server over SSH from a GitHub-hosted job, which needs inbound SSH and a private key stored as
a GitHub secret. Also rejected: a webhook endpoint on the server, which needs a shared secret in GitHub and a new
public endpoint.

### 3. Workflow guard test

`tests/workflows.test.ts` parses every file in `.github/workflows/` and fails if:

| Rule | Why |
|---|---|
| A trigger is anything other than `push`, `pull_request` or `workflow_dispatch` | `pull_request_target`, `workflow_run`, `issue_comment` and similar run fork-influenced input with write tokens |
| A job's `runs-on` is anything other than a label in the allowlist (`ubuntu-24.04`), including any expression | catches a self-hosted runner coming back |
| A `uses:` isn't `owner/repo[/path]@<40-hex>` followed by a `# v…` comment (`./` local actions are allowed) | pinning by SHA |
| A `container`, `services` or `docker://` image isn't pinned by `@sha256:` | same, for images |
| A workflow has no top-level `permissions:`, or a job asks for a write permission outside the allowlist (`deployments: write` on `request-dev-deploy` and `deploy-prod`) | least privilege |
| A `run:` contains `${{ github.event.… }}`, `${{ github.head_ref }}` or `${{ inputs.… }}` | script injection; values go through `env:` |
| `actions/checkout` lacks `persist-credentials: false` | the token isn't left in `.git/config` |
| Anything references `secrets.` | there are no secrets by design |
| A job has no `timeout-minutes` | runaway jobs |

The test runs in `pnpm check`, in CI, and in the pre-commit hook, which already runs `tests/`. It protects against
mistakes, ours or an agent's. It doesn't protect against a hostile fork, and after this change it doesn't have to.

Each rule has a failing fixture in `tests/fixtures/workflows/`, so a rule that stops matching is noticed.

### 4. Scanners

- **gitleaks in CI**, as the *Secrets scan* job. It uses the pinned image and `.gitleaks.toml` from `publish-audit`,
  and scans the pushed or PR commit range. If the base SHA is all zeros, as on the first push of a new branch or repo,
  it scans every commit.
- **gitleaks in pre-commit.** It scans the staged changes with `gitleaks` if it's on `PATH`, otherwise through the
  pinned Docker image. If neither is available, it prints one line saying the scan was skipped and continues, so
  contributors without Docker can still commit. CI is the check that every change has to pass.
- **zizmor in CI**, as the *Workflow lint* job, with a pinned release and its default settings. If a finding is
  accepted, it goes in `.github/zizmor.yml` with the reason. The guard test covers the rules specific to this project,
  and zizmor catches the general GitHub Actions problems, such as cache poisoning.
- **GitHub secret scanning with push protection.** This is a repository setting, applied in `go-public` (section 6).

### 5. Dependencies

`.github/dependabot.yml`:

- `npm` (pnpm lockfile) and `github-actions` ecosystems, weekly;
- grouped minor and patch updates, one group for dependencies and one for devDependencies;
- `cooldown` of 7 days, and 14 for major versions, so a hijacked release has time to be caught before a PR appears;
- at most 5 open PRs.

`pnpm-workspace.yaml` gains `minimumReleaseAge: 10080` (7 days), so local `pnpm add` and `pnpm update` also skip
versions released in the past week. `--frozen-lockfile` installs aren't affected.

Dependabot security alerts and security updates are turned on through settings (section 6).

### 6. GitHub settings as code

Settings live outside git, and `go-public` creates a new repo, so the desired settings are committed and applied by a
script instead of being clicked in by hand.

`scripts/github/settings.ts`:

- `--check` reads the live settings with `gh api` and prints every difference from the desired state. It exits
  non-zero if there is any difference.
- `--apply` sets them.
- It runs `gh` as a subprocess with the owner's login, so the script never handles a token.
- API responses are treated as `unknown` and narrowed before use.

| Setting | Desired | Can be set while private? |
|---|---|---|
| Ruleset `main-history` | `refs/heads/main`: block deletion and force pushes. **No bypass**, the owner included. | no, applied by `go-public` |
| Ruleset `main-changes` | `refs/heads/main`: require a PR (0 approvals, squash merges only) and the required checks below, from the GitHub Actions app (`integration_id` 15368), so other apps can't spoof them. **Bypass: repository admin, always**, so the owner keeps pushing directly. | no, applied by `go-public` |
| Required checks | Lint, types, unit tests, build, audit · Component tests · Database tests · Secrets scan · Workflow lint | (part of `main-changes`) |
| Secret scanning, push protection | on | no, applied by `go-public` |
| Private vulnerability reporting | on | no, applied by `go-public` |
| Dependabot alerts, security updates | on | yes |
| Actions: allowed actions | GitHub-owned actions plus `pnpm/action-setup@*` | yes |
| Actions: require SHA pinning | on (`sha_pinning_required`) | yes |
| Workflow token default | read-only, and workflows can't approve PRs (already the case) | yes |
| Fork PR approval | first-time contributors | no, applied by `go-public` |
| Self-hosted runners | none registered | yes |
| Variables and secrets | none (`CI_RUNNER` deleted) | yes |
| Collaborators | the owner only | yes |
| Deploy keys | read-only only | yes |
| Environments | `dev` and `production`, deployments from `main` only (already the case) | yes |
| Wiki, Projects | off. A public wiki can be edited by any GitHub user by default. | yes |

The two rulesets live as JSON in `.github/rulesets/`, in the format GitHub's ruleset import accepts, so they can be read
and diffed.

### 7. `SECURITY.md`

A short file at the repo root that covers:

- **Supported versions:** `main` and agenticlibrary.app only.
- **How to report:** GitHub private vulnerability reporting, with a link. Never a public issue.
- **What to expect:** one maintainer, who aims to reply within 7 days and coordinates disclosure, with 90 days as the
  default.
- **In scope:** the code in this repository and agenticlibrary.app.
- **Out of scope:** denial of service and volume testing, social engineering, and scanner output with no demonstrated
  impact.
- **Good faith:** test only against your own accounts, and don't access or change other users' data.

## Cut-over

Code changes and owner steps, in this order, while the repo is still private:

1. **Code:** merge the CI, poller, test, scanner, Dependabot and settings-script changes.
2. **Owner:** create the server token, install `scripts/deploy/*` and the systemd timer on the server, and give the
   poller's user the same sudo rule the runner's user has. Run `poll.ts --dry-run` first.
3. **Check:** the next push to `main` goes green on GitHub-hosted runners, the `dev` deployment is created, and the
   server deploys it and reports `success`.
4. **Check:** `gh workflow run deploy-prod.yml -f sha=<that sha>` gets production deployed the same way.
5. **Owner:** deregister `LINUX-LAPTOP`, then remove the runner service and its sudo rule from the server, and delete the
   `CI_RUNNER` variable.
6. **Owner:** run `node scripts/github/settings.ts --apply`, then `--check`. Only the rows marked "applied by
   `go-public`" may still differ.

`go-public` later creates the new repo and runs `--apply` and `--check` until there are no differences. It also
re-scopes the server token to the new repository, because fine-grained tokens are bound to a repository ID, not a name.

## Commands

```
pnpm check                                         Lint, types, unit tests (includes tests/workflows.test.ts)
pnpm exec vitest run tests/workflows.test.ts       Guard test on its own
pnpm exec vitest run scripts/deploy scripts/github Poller decision logic and settings diff
node scripts/github/settings.ts --check            Compare live GitHub settings with the desired state (owner's gh login)
node scripts/github/settings.ts --apply            Apply them
node scripts/deploy/poll.ts --dry-run              On the server: what would be deployed, changing nothing
gh workflow run deploy-prod.yml -f sha=<sha>       Request a production deploy of a dev-tested commit

# Scanners, the way CI runs them (image tags pinned by digest during implementation)
docker run --rm -v "$PWD:/repo:ro" ghcr.io/gitleaks/gitleaks@sha256:<digest> \
  git /repo --log-opts="$BASE..$HEAD" --config /repo/.gitleaks.toml --redact
docker run --rm -v "$PWD:/repo:ro" <zizmor image>@sha256:<digest> /repo/.github/workflows
```

## Files

```
.github/workflows/ci.yml         GitHub-hosted jobs, pinned, plus Secrets scan, Workflow lint and request-dev-deploy
.github/workflows/deploy-prod.yml GitHub-hosted; validates, then requests the production deployment
.github/dependabot.yml           npm and github-actions, weekly, grouped, with cooldown
.github/rulesets/main-history.json  No-bypass ruleset: no deletion, no force push
.github/rulesets/main-changes.json  PR and required checks, admin bypass
.github/zizmor.yml               Only if a finding is accepted, with the reason
.githooks/pre-commit             Adds the staged gitleaks scan
pnpm-workspace.yaml              minimumReleaseAge
package.json                     devDependency `yaml` (approved)
SECURITY.md                      Reporting policy
scripts/deploy/decide.ts         Pure decision: deploy, refuse with a reason, or supersede
scripts/deploy/decide.test.ts
scripts/deploy/poll.ts           Server-side poller (HTTP to GitHub, runs the deploy script)
scripts/deploy/folio-deploy-poll.service, .timer   systemd units, installed by hand
scripts/github/settings.ts       --check and --apply for the settings table
scripts/github/settings.test.ts  Diff logic against recorded API responses, no network
tests/workflows.test.ts          Guard test
tests/fixtures/workflows/        One failing workflow per rule
```

## Code style

Follow [CODE_STANDARDS.md](../CODE_STANDARDS.md): descriptive names, `/** */` comments, and no `any`. Parsed YAML
and API responses start as `unknown`:

```ts
import { parse } from 'yaml'

/** Labels a job may run on. Anything else, including an expression, could reach a self-hosted runner. */
const HOSTED_LABELS = new Set(['ubuntu-24.04'])

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
}

function runnerProblems(file: string, workflowText: string): string[] {
  const workflow: unknown = parse(workflowText)
  if (!isRecord(workflow) || !isRecord(workflow.jobs)) return [`${file}: has no jobs map`]
  return Object.entries(workflow.jobs).flatMap(([jobName, job]) => {
    const runsOn = isRecord(job) ? job['runs-on'] : undefined
    return typeof runsOn === 'string' && HOSTED_LABELS.has(runsOn)
      ? []
      : [`${file}: job ${jobName} runs on ${JSON.stringify(runsOn)}, not a GitHub-hosted label`]
  })
}
```

## Testing strategy

- **Guard test:** Vitest, in `tests/`. It passes on the real workflows, and each fixture in
  `tests/fixtures/workflows/` fails with the expected message.
- **Poller:** unit tests on `decide()` for each refusal (bad SHA, not on `main`, CI not green, production without a
  successful dev deploy), for superseding older dev requests, and for a SHA that is already deployed. `poll.ts` is
  checked by `--dry-run` on the server and by the live cut-over steps, not by unit tests against GitHub.
- **Settings script:** unit tests feed recorded `gh api` responses into the diff, and check matching, differing and
  missing settings. The live `--check` is run by the owner.
- **Scanners:** a canary key, shaped like a real key and not in the allowlist, is committed on a throwaway branch. The
  Secrets scan job must fail on it, and the pre-commit hook must refuse it in a scratch clone. Then the branch is
  deleted. It is never merged, and the public repo only receives `main`.
- **End to end:** the cut-over steps above are the acceptance test for deploys.
- Existing coverage floors stay as they are. The new `scripts/` modules aren't in the coverage `include` globs, and
  adding them is out of scope.

## Boundaries

- **Always:**
  - pin actions by SHA and images by digest, with the version in a comment;
  - give every workflow top-level `permissions:` and the least each job needs;
  - pass untrusted context to `run:` through `env:`;
  - have the server validate every deploy request itself.
- **Ask first:**
  - installing or changing anything on the server, which is the owner's step;
  - running `settings.ts --apply` against the current repo;
  - deregistering the runner, or deleting `CI_RUNNER`;
  - pushing the canary branch;
  - creating the server token.
- **Never:**
  - register a self-hosted runner;
  - add `pull_request_target`, `workflow_run` or comment-triggered workflows;
  - add repository or environment secrets;
  - let the poller deploy a SHA it hasn't validated;
  - update the installed poller automatically from the repo;
  - grant the server token more than the four permissions listed;
  - print a token or environment value in a log, a step summary or a deployment status.

## Success criteria

- [ ] No workflow has a self-hosted job, `gh api repos/orhunakkan/agentic-library/actions/runners` returns
      `total_count: 0`, and `CI_RUNNER` is deleted.
- [ ] `tests/workflows.test.ts` passes on the real workflows, and every fixture fails with its rule's message.
- [ ] Three consecutive pushes to `main` run the full suite green on GitHub-hosted runners.
- [ ] A same-repo PR runs every test job, and `request-dev-deploy` is skipped.
- [ ] A push to `main` produces a `dev` deployment that the server deploys and marks `success` within 2 minutes of CI
      finishing.
- [ ] `deploy-prod.yml` with a dev-tested SHA gets production deployed and marked `success`. With a SHA that wasn't
      tested on dev, it fails before creating a deployment.
- [ ] A deployment request made by hand with `gh api` for a SHA that isn't on `main` is marked `failure` by the server,
      and the deploy script isn't run (shown in the server journal).
- [ ] `decide.test.ts` covers every refusal and the supersede case.
- [ ] The canary fails the Secrets scan job and is refused by the pre-commit hook. The fake keys in the allowlist pass.
- [ ] zizmor reports no findings, or each accepted one is in `.github/zizmor.yml` with a reason.
- [ ] Dependabot reports a successful run for both ecosystems in the repository's dependency graph.
- [ ] `settings.ts --check` against the current repo shows differences only in the rows marked "applied by
      `go-public`".
- [ ] `SECURITY.md` exists and links to private vulnerability reporting.
- [ ] `pnpm check` passes, and the pre-commit hook passes on a normal commit.
- [ ] No CI log or step summary contains an environment value, a token or a server path other than the accepted
      `/usr/local/bin/agentic-library-deploy`.

## Risks

- **Private Actions minutes.** Until `go-public`, the repo is private, and GitHub-hosted runs count against the free
  2,000 minutes a month. A full run might take about 20 minutes on 2-vCPU private runners. With no paid budget set, jobs
  stop when the quota runs out, and nothing is charged. Mitigation: build this module late, right before
  `contributor-docs` and `go-public`, and check usage. Once the repo is public, minutes are free and the runners have
  4 vCPUs.
- **Flaky tests on new hardware.** The coverage floors on `src/server/email/store.ts` and `actions.ts` have missed
  once in CI with every test green. Rerun before debugging. If GitHub-hosted runners make it worse, find the cause in
  this module, but don't skip tests or lower floors.
- **Deploy delay.** Polling adds up to 30 seconds plus the deploy time. This is accepted.
- **Server token expiry.** Deploys stop until the token is renewed. The owner sets a reminder before the expiry date.

## Out of scope (deferred)

- Running the poller from a GitHub App instead of a personal token. A token is simpler for one owner.
- Requiring signed commits. Contributors' PRs are squash-merged by GitHub, which signs them. Requiring signatures on the
  owner's direct pushes can come later.
- OpenSSF Scorecard and its badge, which can be added once the repo is public.
- `CODEOWNERS`. With one maintainer, it adds nothing that the rulesets don't already do.
- Container image updates through Dependabot. Images stay bumped by hand with the `playwright` package.
- Adding `scripts/` to the coverage floors.

## Changes to other specs

Made in this session:

- **Capability map:** the CI / deploy decision, the `repo-security` and `go-public` rows, the new dependency on
  `publish-audit`, the build order, the Progress row, the runner facts and risk, the fork-PR item under Resolved, and the
  deferred item that rejected GitHub-hosted CI. Assumption 3 also said "AGPL" where the licence is MIT, and now says MIT.
- **`publish-audit`:** `go-public` no longer moves the runner or `CI_RUNNER`. The poller's install path and systemd units
  join the infrastructure details and the "Accepted as public" list.

Still to be written into **`go-public`** when its spec is written: there is no runner to move. It runs `settings.ts
--apply` and `--check`, re-creates the deploy key and the environments, and re-scopes the server token.

## Decisions

- **No self-hosted runners**, deploys included. *(2026-11-25)*
- **Two rulesets on `main`:** `main-history` with no bypass, and `main-changes` with an admin bypass. *(2026-11-25)*
- **Deploys:** a poller on the server validates and runs GitHub Deployment requests. SSH from a GitHub-hosted job and
  a webhook on the server were rejected, because both put a credential in GitHub and open something inbound.
  *(2026-11-25)*
- **`yaml` devDependency** (ISC licence, no dependencies) for the guard test. *(2026-11-25)*
- **zizmor runs in CI** next to the guard test. *(2026-11-25)*
- **Fork PR approval: first-time contributors.** A fork run can't reach anything privileged. *(2026-11-25)*

## Open questions

None.
