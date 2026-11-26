# Capability Map: Open-source Folio — V1

Status: approved (2026-11-25)

Make the `orhunakkan/agentic-library` repository public under the MIT licence, turn agenticlibrary.app into a free service
with open sign-up, and make the project safe and practical for outside contributors.

## Decisions so far

| Topic | Decision |
|---|---|
| Business model | Free hosted service, no billing. Paddle, Free/Pro plans and pricing UI are removed. |
| What users get | Every account gets what Pro has today. The current Pro caps stay as abuse limits that the operator can configure. |
| Sign-up on agenticlibrary.app | Open (`SIGNUP=open`). This already needs `MAIL_TRANSPORT=resend` and `SITE_CONTACT` ([config.ts](../src/server/config.ts)). |
| Current users | Only the owner, so there are no subscribers to migrate or notify. |
| Contributions | Outside PRs are welcome from day one. Only the owner can merge, and a branch ruleset enforces it. |
| Git history | `main`'s full history is published in a **new** public repo. Its author emails are rewritten to the GitHub no-reply address, and the `#N` references are left as they are. The current repo, with its old PRs, issues and CI logs, becomes a private archive. See [SPEC-publish-audit.md](SPEC-publish-audit.md). |
| CI / deploy | **All CI moves to GitHub-hosted runners, and no self-hosted runner is left.** The `if:` fork guard can't protect a self-hosted runner, because a fork PR controls the workflow file it runs. The server pulls deploy requests instead of running jobs. Decided 2026-11-25 in [SPEC-repo-security.md](SPEC-repo-security.md). |
| Built-in catalogue | Stays empty. Every user starts with an empty library, so no content needs publishing or licence review. |
| Login | Unchanged: password, passkeys and personal access tokens. There is no OAuth in the code and none is added. |
| Licence | **MIT.** `package.json` changes from `AGPL-3.0-only` (set in the first commit and never published) to `MIT`, and a `LICENSE` file is added. The owner accepts that forks may be run closed-source or sold. All dependencies are compatible (MIT, ISC, Apache, BSD, MPL-2.0, Unlicense). **One exception, accepted 2026-11-25:** the Folio voice worker ships espeak-ng and piper-phonemize, which are GPL-3.0, inside `@diffusionstudio/piper-wasm`. They're shipped with their source offered, and Folio's own code stays MIT. See [SPEC-legal-and-attribution.md](SPEC-legal-and-attribution.md). |

## Assumptions (correct any of these)

1. The `LICENSE` copyright line reads "Copyright (c) 2026 Orhun Akkan".
2. The name stays **Folio**, the repo stays `orhunakkan/agentic-library` and the domain stays `agenticlibrary.app`.
3. There is **no CLA and no DCO**. Contributions come in under the same MIT licence as the project.
4. Migrations stay append-only. The billing tables and columns from `0018_plans.sql` and `0019_billing.sql` are dropped
   by a **new** migration, shipped one release after the code that stops using them.
5. Closing the Paddle account, Resend and DNS setup, and GitHub repo settings are **manual steps for the owner**. The spec
   lists them, but code doesn't do them.
6. `spec/` and `tasks/` are committed and become public along with the rest of the repo.

## Modules

| Module id | Responsibility | Depends on |
|---|---|---|
| `publish-audit` | Scan the full git history and working tree for secrets (gitleaks) and for personal or infrastructure details. Record what is accepted as public, such as the deploy script path and the owner's name. | — |
| `repo-security` | Move every CI job to GitHub-hosted runners and remove the self-hosted runner. Replace runner deploys with a poller on the server that checks each GitHub Deployment request itself. Add rulesets on `main`, Dependabot, gitleaks in CI and pre-commit, zizmor, secret scanning with push protection, private vulnerability reporting and `SECURITY.md`. Pin actions by SHA and images by digest. Add a test that blocks self-hosted jobs and dangerous triggers, and a script that checks and applies the GitHub settings. | `publish-audit` |
| `billing-removal` | Remove Paddle, plans, Pro gating, pricing and checkout UI, `/refunds`, admin Pro grants, billing config and env vars, `scripts/billing/`, and the related unit, db and e2e tests (about 96 files touch this). Then the drop migration. | — |
| `instance-limits` | Turn the six storage caps under "Hosted limits" into operator config, with today's Pro values as defaults, and add the new 1 MB cap on one article's stored text. Document the hosted values. | `billing-removal` |
| `legal-and-attribution` | Rewrite Terms and Privacy for a free service with open sign-up. Add a copyright and takedown contact for uploaded books. Add a link to the source repository in the footer; MIT doesn't require it, but it's how users and contributors find the project. | `billing-removal` |
| `contributor-docs` | `LICENSE` (MIT) and the `package.json` licence field, `README` (what Folio is, quick start), `CONTRIBUTING` (setup, `pnpm check`, code standards, how fork PRs are tested), `CODE_OF_CONDUCT`, issue and PR templates, `.env.example`, and a `docker compose` Postgres for local dev and tests. | `billing-removal`, `instance-limits`, `repo-security` |
| `go-public` | Final audit re-run. Rename the current repo to a private archive and create a new public `orhunakkan/agentic-library`. Rewrite `main`'s author emails to the no-reply address, then push only `main`. Apply the GitHub settings with `scripts/github/settings.ts --apply` and check them with `--check`. Re-create the deploy key and the environments, and re-scope the server's deploy token to the new repo. The new repo is created private, verified on the remote, then made public. Redeploy dev and prod, then open sign-up on both (`SIGNUP=open`) in the same sitting, and run post-launch checks. | all of the above |

Build order: `publish-audit`, `billing-removal` (independent, any order) → `repo-security`, `instance-limits`,
`legal-and-attribution` → `contributor-docs` → `go-public`. Build `repo-security` as late as its dependencies allow: until
the repo is public, GitHub-hosted runs use the private plan's 2,000 free minutes a month.

Each module gets its own `spec/SPEC-<module-id>.md`, written and approved in this order.

## Progress

| Module | Spec | Plan and tasks | Built |
|---|---|---|---|
| `publish-audit` | [approved 2026-11-25](SPEC-publish-audit.md) | [plan](../tasks/publish-audit-plan.md), [tasks](../tasks/publish-audit-todo.md) | done, signed off 2026-11-25 ([report](publish-audit-report.md)) |
| `repo-security` | [approved 2026-11-25](SPEC-repo-security.md) | — | — |
| `billing-removal` | [approved 2026-11-25](SPEC-billing-removal.md) | — | — |
| `instance-limits` | [approved 2026-11-25](SPEC-instance-limits.md) | — | — |
| `legal-and-attribution` | [approved 2026-11-25](SPEC-legal-and-attribution.md) | — | — |
| `contributor-docs` | [approved 2026-11-25](SPEC-contributor-docs.md) | — | — |
| `go-public` | [approved 2026-11-25](SPEC-go-public.md) | — | — |

The owner chose to write every module spec before planning or building any of them. Specs are written one per
session.

### How each module is planned and built

These rules apply to every module, decided 2026-11-25:

- **One module at a time**, in the build order below. A module is planned in one session and built in another.
- **Plan files are named per module:** `tasks/<module>-plan.md` and `tasks/<module>-todo.md`, never a generic
  `tasks/plan.md`.
- **Each build runs in one go**, from the first task to the last. The owner reviews the finished work once, at the
  end, and doesn't approve checkpoints along the way. Checkpoints are self-checks: if one fails, fix it and re-run it.
- **Anything only the owner can do goes in a "Needs owner action" list** in the module's deliverable, and the build
  carries on. That covers rotating secrets, sudo installs, and any action the spec marks as ask-first. The
  build never does these on the owner's behalf.
- **A stop that can't be avoided goes in a preflight task** (Task 0), before any work starts. A missing tool is an
  example.
- **The build ends with one local commit on `main`**, unless its spec says otherwise. The owner pushes after
  reviewing.
- **When a build is done**, the module's Progress row says "built, awaiting sign-off", and the deliverable ends with an
  empty `Signed off: ____ (date)` line.
- **Sign-off is the owner's decision, and Claude records it.** When the owner says a module is signed off, Claude
  fills in the line (`Signed off: Orhun Akkan (<date>)`), marks the Progress row done, and commits and pushes. The
  owner doesn't edit the file by hand. A build never signs off on its own.

Facts for the `repo-security` spec, gathered 2026-11-25:
- **CI layout.** [ci.yml](../.github/workflows/ci.yml) runs checks, component, db, e2e and deploy-dev, all on
  `runs-on: ${{ vars.CI_RUNNER }}`. That's the self-hosted runner `LINUX-LAPTOP`. Deploys run
  `sudo -n /usr/local/bin/agentic-library-deploy`.
- **Fork guard.** Every test job has
  `if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository`.
- **Production deploy.** [deploy-prod.yml](../.github/workflows/deploy-prod.yml) is `workflow_dispatch` only, guarded
  by `github.ref == 'refs/heads/main' && github.actor == github.repository_owner`.
- **Pinning.** Actions are pinned by major tag (`actions/checkout@v7`), not by SHA.
- **Currently on GitHub:** environments `dev` and `production`, variable `CI_RUNNER`, 1 deploy key, no secrets. The
  deploy key and environments are re-created under `go-public`. The runner and `CI_RUNNER` are removed by `repo-security`.
- **Superseded on 2026-11-25:** no self-hosted runners at all; see the CI / deploy decision.
- **Originally decided in the map:** keep the self-hosted runner and the fork guard, and add a GitHub-hosted workflow for fork
  PRs that runs lint, types and unit tests with no secrets. Branch ruleset on `main` so only the owner merges, plus
  Dependabot, secret scanning with push protection, private vulnerability reporting, `SECURITY.md`, actions pinned by
  SHA, and a test that fails if `pull_request_target` appears or a self-hosted job can be triggered by a fork.
- **From the audit spec:** `.gitleaks.toml` exists for reuse. `repo-security` decides whether gitleaks runs in CI and
  in pre-commit.

## Risks already visible

- **Self-hosted runner with passwordless sudo on a public repo.** This is resolved by removing the runner. The `if:` guard
  in [ci.yml](../.github/workflows/ci.yml) was never a boundary, because a fork PR runs its own copy of the workflow file.
  `repo-security` moves CI to GitHub-hosted runners, and the server pulls only deploy requests that it checks itself.
  The test in `tests/workflows.test.ts` fails if a self-hosted job or `pull_request_target` comes back.
- **Public CI logs and artifacts.** Once the repo is public, anyone can read the logs and download the artifacts, such
  as `playwright-report`. They must never print environment values, server paths beyond those already accepted, or
  real user data.
- **Open sign-up storage.** Today's Pro cap allows 8 GB of audiobooks per user (`MAX_USER_AUDIO_BYTES`). With open
  sign-up that becomes a hosting cost and abuse risk, so `instance-limits` exists to let the hosted site set lower values.
- **Copyright on uploads.** Uploaded books and audiobooks are per-user, but open sign-up still needs a takedown contact
  and a policy in the Terms.

## Out of scope (deferred)

- Donations or GitHub Sponsors: a separate decision once the project is public.
- A production `Dockerfile` or one-click self-host deploy. V1 documents running from source; container packaging is V2.
- OAuth or social login: not requested, and open-sourcing doesn't need it.
- A built-in public-domain starter catalogue: everyone starts empty in V1.

## Resolved

- **Fork-PR workflow:** superseded. Every PR, from a fork or not, runs the full suite on GitHub-hosted runners with no
  secrets ([SPEC-repo-security.md](SPEC-repo-security.md)).
- **Operator identity:** the owner's name stays on the Terms, Privacy page and footer.
- **Contributor sign-off:** no CLA and no DCO. Contributions come in under the project's MIT licence.

- **Hosted limits.** These storage caps become operator config. agenticlibrary.app uses the hosted values, and
  self-hosters get the defaults, which are today's Pro values:

  | Setting | Variable | Hosted | Default |
  |---|---|---|---|
  | Audiobook storage per user, all audiobooks combined | `LIMIT_USER_AUDIO` | 1 GB | 8 GB |
  | Size of one audiobook | `LIMIT_AUDIOBOOK_SIZE` | 1 GB | 2 GB |
  | Picture storage per user, books and articles combined | `LIMIT_USER_PICTURES` | 100 MB | 250 MB |
  | Books per user | `LIMIT_BOOKS` | 25 | 25 |
  | Saved articles per user | `LIMIT_ARTICLES` | 500 | 500 |
  | Stored text of one article (**new cap**) | `LIMIT_ARTICLE_TEXT` | 1 MB | 1 MB |

  Format, validation and the admin decision (none: the owner is held to the same limits) are in
  [SPEC-instance-limits.md](SPEC-instance-limits.md).

  Most one user can store on the hosted site: about 1.8 GB in theory, about 1.2 GB for a realistic heavy user (almost
  all audiobooks). Row-count limits (highlights, flashcards, shelves, prompts) stay constants. Rationale: audio dominates
  storage, raising a cap later is free while lowering one strands existing users, and `MIN_FREE_BYTES` already refuses
  audiobook uploads when the disk drops below 10 GB free.

## Open questions

None at the map level. Questions about individual modules go in each module's spec.
