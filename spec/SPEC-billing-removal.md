# Spec: billing-removal — V1

Status: approved (2026-11-25)

Module of [capability-map.md](capability-map.md). It depends on nothing. `instance-limits`, `legal-and-attribution` and
`contributor-docs` depend on it.

## Objective

Folio becomes a free service with no billing. Remove Paddle, the Free and Pro plans, Pro gating, pricing and checkout,
`/refunds`, admin Pro grants, billing config and env vars, and `scripts/billing/`, together with their tests. Every
signed-in account gets everything Pro has today. Then drop the billing tables and columns in a later release.

**Who it's for:** readers, who stop seeing prices, upgrade prompts and locked features, and the owner and contributors,
who stop maintaining about 100 files of payment code that a free service doesn't need.

**What success looks like:** nothing in the code, the UI, the config or the database mentions Paddle, a plan, Pro,
a price or a refund. Every feature that Pro unlocks today works for every account, and the limits each account gets
are today's Pro limits.

## What the code does today

Facts gathered 2026-11-25.

- **The plan is worked out, never stored.** `proSql` in [plan.ts](../src/server/plans/plan.ts) makes an account Pro
  if it is an admin, if `users.pro_granted_at` is set, or if it has a `subscriptions` row with an active status.
  [sessions.ts](../src/server/sessions.ts) and [access-tokens/store.ts](../src/server/access-tokens/store.ts) put the
  result on every session as `plan: 'free' | 'pro'`.
- **Seven gated features** (`PRO_FEATURE_NAMES` in [plans.ts](../src/shared/plans/plans.ts)): `ask`, `translate`,
  `export`, `audiobooks`, `elevenlabs`, `flashcards` and `run`. The server refuses them with
  `403 { error: 'pro', feature }` through `requirePro` (9 call sites) and `canUse` (4 call sites). The client hides or
  disables them, and shows `ProNotice` instead.
- **Two sets of limits.** `limitsFor(plan)` gives Free 2 books, 50 highlights and `FREE_ARTICLES` saved articles. Pro
  gets `MAX_BOOKS` (25), `MAX_HIGHLIGHTS_PER_BOOK`, `MAX_HIGHLIGHTS_PER_USER` and `PRO_ARTICLES` (500). Quota refusals
  send `{ error: 'quota', scope, max, plan }`, and the client chooses its message (`quota-free` or `quota`) by `plan`.
- **Every Pro feature that costs money runs on the reader's own key.** Ask, Translate and ElevenLabs check `hasKey`
  first. Run code runs in the browser. So making them free costs the operator nothing beyond storage, which
  `instance-limits` handles.
- **Paddle:** `src/server/billing/` (API client, signature check, webhook, reconcile, store), the webhook route
  [billing/paddle.ts](../src/routes/billing/paddle.ts), the Pro page and checkout under `src/routes/account/plan/`,
  `src/client/features/billing/`, `scripts/billing/reconcile.ts`, and the `@paddle/paddle-js` dependency.
- **Config:** `parseBilling` in [config.ts](../src/server/config.ts) reads `PADDLE_ENV`, `PADDLE_CLIENT_TOKEN`,
  `PADDLE_PRICE_MONTHLY`, `PADDLE_PRICE_YEARLY`, `PADDLE_PRICE_FOUNDING` and `PADDLE_API_BASE`, plus `paddle_api_key`
  and `paddle_webhook_secret` from systemd credentials or the env. With none of them set, billing is off and the home
  page says "Pro is coming soon".
- **Account deletion** cancels the Paddle subscription first and returns `billing_failed` if Paddle can't be reached
  ([admin/store.ts](../src/server/admin/store.ts)). `scripts/db/users.ts delete` has `--skip-billing` for that case.
- **Admin grants:** the Users page and `scripts/db/users.ts grant-pro | revoke-pro` set `pro_granted_at`, and write
  `plan.granted` and `plan.revoked` audit events.
- **Schema:** [0018_plans.sql](../db/migrations/0018_plans.sql) adds `users.pro_granted_at` and
  `users.pro_granted_by`. It also adds `user_books.starter`, which belongs to the starter book, not billing.
  [0019_billing.sql](../db/migrations/0019_billing.sql) creates `subscriptions` and `paddle_events`. Migrations are
  checksummed by [migrate.ts](../scripts/db/migrate.ts), so they can't be edited, only followed.
- **Deploy order.** A deploy runs the new migrations while the previous release is still serving (see the comments in
  0018). So a column can only be dropped once a release that doesn't read it is already live.

## What changes

### 1. One set of capabilities

- `Plan`, `PlanSource`, `ProFeature`, `PRO_FEATURE_NAMES`, `DEVICE_FEATURES`, `FREE_LIMITS`, `PRO_LIMITS`, `limitsFor`,
  `canUse`, `isPlan`, `isProFeature`, `PRO_FEATURES` and `PRO_LINK` are deleted, and so is
  [src/shared/plans/](../src/shared/plans/) as a whole, including `copy.ts` and `pricing.ts`.
- Callers use the limits that already exist: `MAX_BOOKS`, `MAX_HIGHLIGHTS_PER_BOOK` and `MAX_HIGHLIGHTS_PER_USER`.
  `PRO_ARTICLES` is renamed `MAX_ARTICLES`, and `FREE_ARTICLES` is deleted. The values don't change. `instance-limits`
  later turns them into operator config.
- `src/server/plans/` is deleted: `proSql`, `planFor`, `planSourceFor`, `requirePro`, `requireProText`, `grantPro`,
  `revokePro` and `planUsage`.
- Sessions, access-token sessions and `Viewer` lose `plan`. The session query stops reading `pro_granted_at` and
  `subscriptions`.
- Every `requirePro` and `canUse` check is removed, so each feature runs for any signed-in account. Its other checks
  stay as they are: signed in, own key saved, rate limits, quotas and disk space.
- `ProNotice` and every branch that shows it go. Ask, Translate, Export, Audiobooks, ElevenLabs voices, Flashcards and
  Run code show their normal UI to every signed-in reader.

### 2. Wire contracts

| Response | Today | After |
|---|---|---|
| Gated feature refused | `403 { error: 'pro', feature }`, or the `proNotice` heading as text for export | no longer sent |
| Quota refused | `409 { error: 'quota', scope, max, plan }` | `409 { error: 'quota', scope, max }` |
| `POST /api/me` | `{ username, role, plan, via }` | `{ username, role, via }` |
| Ask prompts page state | `{ state: 'ready', plan, prompts }` | `{ state: 'ready', prompts }` |
| Article save failure | includes `plan` | doesn't |
| Account data export | has a `subscriptions` key | doesn't. `EXPORT_VERSION` stays 1, because nothing imports the format. |
| `/account?error=pro` on saving an API key | sent when a Free reader saves an Anthropic, OpenAI or ElevenLabs key | no longer sent |
| `/account?error=delete-billing` | sent when Paddle couldn't cancel | no longer sent |

The client stops reading `plan` and drops the `quota-free` and `pro` cases. A client that is already cached offline
and still reads `plan` finds it missing. It then treats the reader as Free until its next update, which only hides
features. It doesn't break anything, and only the owner has an account.

### 3. Pages and routes

Deleted:

- `/account/plan` with its `checkout`, `portal` and `state` server routes, and `src/client/features/billing/`;
- `/billing/paddle`, the webhook;
- `/refunds`, with `REFUNDS_UPDATED`;
- `PricingSection` on the home page, and the pricing questions in the FAQ (`PAYING_QUESTIONS`, `NO_TRIAL`);
- `PlanSection` on the account page. Today it shows the plan and usage against the Free limits. Usage against the
  remaining limits is left to `instance-limits` (see Out of scope).

The deleted URLs answer 404, as any unknown path does. No redirects are added, because nothing outside the site links
to them once the Paddle account is closed.

Changed:

- **Home page:** the Hero has no price and no "Pro is coming soon". The pricing section is removed and nothing takes
  its place: no "Free, no plans" line or anything like it. The Hero copy may say Folio is free, but promises nothing
  that `go-public` hasn't shipped yet, such as open source.
- **Footers** (`SiteFooter`, `HomeFooter`): the Refunds link goes. `legal-and-attribution` adds the source link later.
- **Account page:** no plan section. Deleting an account doesn't mention a subscription.
- **API keys page:** saving any key is allowed for every account.
- **Admin Users page:** no plan column, no paid label and no Give Pro or Take Pro buttons.
- **Terms and Privacy:** only the minimum edits, so they stop describing something that no longer exists. The
  "Free and Pro" and "Paying for Pro" parts of the Terms, Paddle as reseller, and the refunds link are removed. The
  subscription data and Paddle as a processor are removed from Privacy. `TERMS_UPDATED` and `PRIVACY_UPDATED` move to
  the release date. **The full rewrite for a free service with open sign-up is `legal-and-attribution`'s work**, and
  this module doesn't add new terms.

### 4. Server, scripts and config

- `src/server/billing/` is deleted: `actions`, `paddle-api`, `reconcile`, `signature`, `store`, `webhook` and
  `webhook-input`, with their tests. So are `src/shared/billing/`, `src/server/testing/paddle.ts` and
  `scripts/billing/`.
- `deleteAccount` no longer calls Paddle. `DeleteResult` loses `billing_failed`, the account and admin actions lose
  their `billing_failed` branches, and `deleteAccount`'s `skipBilling` and `paddle` options go.
- `scripts/db/users.ts`: `grant-pro`, `revoke-pro` and `--skip-billing` are removed, and `list` has no plan column.
- [config.ts](../src/server/config.ts): `BillingConfig`, `PaddleEnv`, `parseBilling` and the `billing` field go.
  Leftover `PADDLE_*` env vars and `paddle_*` credentials are **ignored**, not refused, so a server that still has them
  starts normally until the owner removes them.
- [audit.ts](../src/server/audit.ts): `plan.granted`, `plan.revoked`, `billing.checkout` and `billing.subscription`
  leave the event type. Rows already in `audit_events` stay. They are the owner's history, and the audit log is
  never rewritten.
- [redact.ts](../src/server/redact.ts): the `pdl_` pattern goes, since no Paddle key reaches the process any more.
- `package.json`: `@paddle/paddle-js` is removed, and `pnpm-lock.yaml` is updated.
- [playwright.config.ts](../playwright.config.ts): the `PADDLE_*` env and the `plans` and `billing` projects go.

### 5. Tests

- **Deleted:** tests of deleted modules, which are `src/server/billing/*.test.ts`, `src/shared/billing/*`,
  `src/shared/plans/*`, `src/server/plans/plan.db.test.ts` and `src/client/features/billing/*`. Also the e2e specs
  `billing.spec.ts` and `plans.spec.ts`, `tests/e2e/pages/pro-page.ts`, and `tests/e2e/support/paddle-stub.ts` and
  `fake-paddle.ts`.
- **Deleted cases:** a test whose only point is that a Free account is refused, or sees a Free message or a Pro
  notice.
- **Kept and simplified:** a test that sets up a Pro account to reach a feature keeps its assertions and loses the
  setup. `src/server/testing/users.ts`, `user-rows.ts` and the e2e `test-server.ts` lose their `plan` parameter and
  their `pro_granted_at` and `subscriptions` rows.
- **Kept and inverted where it matters:** for each of the seven features, one existing test (db or e2e) shows that a
  plain member, with no grant, can use it. For each quota, one test shows that the limit is the former Pro value.
- `tests/tested-modules.test.ts` loses its `use-checkout.ts` entry. `bundle.spec.ts` keeps checking that server-only
  SQL stays out of the client bundle, with the billing strings removed from its list.
- **Coverage floors don't go down.** If deleting well-covered billing code takes a global total below its floor in
  `vitest.config.ts` or `vitest.db.config.ts`, the fix is more tests, not a lower floor.

### 6. Drop migration (release 2)

A new migration, numbered after the newest one at the time it's written (so `0029` if nothing else lands first):

```sql
-- Billing removed (spec/SPEC-billing-removal.md). The previous release no longer reads any of these, so they go.
drop table paddle_events;
drop table subscriptions;
alter table users drop column pro_granted_by;
alter table users drop column pro_granted_at;
```

`user_books.starter` and `users.starter_book_at` are left alone, because they belong to the starter book (see Out of
scope). `0018_plans.sql` and `0019_billing.sql` stay as they are.

## Cut-over

1. **Release 1 (code):** merge sections 1 to 5. CI goes green. It deploys to dev, and then the owner deploys it to
   production. From then on, nothing reads `pro_granted_at`, `pro_granted_by`, `subscriptions` or `paddle_events`.
2. **Check:** on dev and production, a member account with no grant can use all seven features. `/account/plan`,
   `/refunds` and `/billing/paddle` answer 404. The journal shows no error mentioning Paddle or the dropped names.
3. **Release 2 (migration):** merge the drop migration in a separate commit, only after release 1 is live on
   production. It deploys to dev, then to production.
4. **Owner steps**, which code doesn't do (map Assumption 5). Billing looks off on production, where the home page
   says "Pro is coming soon", so first check what exists. Each step applies only where its thing is set up, and is
   skipped otherwise:
   - if a Paddle webhook destination exists (sandbox or live), remove it before release 1 reaches production, so
     Paddle stops retrying against a 404;
   - if the env files on the server have `PADDLE_*` lines, or systemd has `paddle_api_key` or `paddle_webhook_secret`
     credentials, remove them, for dev and production;
   - if a timer or cron entry runs `scripts/billing/reconcile.ts`, remove it;
   - if Paddle sandbox or live accounts exist, close them. There are no subscribers to refund or notify, because the
     owner is the only user.

## Commands

```
pnpm check                                          Lint, types, unit tests
pnpm test:db                                        Database tests, including the migration
pnpm e2e:local                                      End-to-end on desktop, phone and tablet
pnpm db:migrate                                     Apply the drop migration locally (release 2)
git grep -niE 'paddle|pro_granted|subscriptions|refund|PRO_|FREE_LIMITS|requirePro|canUse\(' -- ':!spec' ':!db/migrations/001[89]_*'
                                                    Leftover check; expected to print nothing
```

## Files

```
src/shared/plans/                     deleted
src/shared/billing/                   deleted
src/server/plans/                     deleted
src/server/billing/                   deleted
src/server/testing/paddle.ts          deleted
src/client/features/billing/          deleted
src/client/features/plans/ProNotice.tsx  deleted
src/client/features/home/PricingSection.tsx  deleted
src/client/features/account/PlanSection.tsx  deleted
src/routes/account/plan/              deleted
src/routes/billing/                   deleted
src/routes/refunds.tsx                deleted
scripts/billing/                      deleted
tests/e2e/specs/billing.spec.ts, plans.spec.ts   deleted
tests/e2e/pages/pro-page.ts           deleted
tests/e2e/support/paddle-stub.ts, fake-paddle.ts deleted
src/server/config.ts, audit.ts, redact.ts, sessions.ts, auth.ts, users.ts
src/server/access-tokens/store.ts, admin/*, account-*.ts, account-data/*
src/server/{ask,ask-prompts,audiobooks,flashcards,highlights,lookup,speech,articles}/*, book-actions.ts
src/client/features/{ask,ask-prompts,articles,audiobook-import,flashcards,highlights,import,lookup,read-aloud,run-code,admin,account,home}/*
src/client/lib/post.ts, components/SiteFooter.tsx
src/routes/index.tsx, terms.tsx, privacy.tsx, account/*, src/shared/lib/site.ts
scripts/db/users.ts, package.json, pnpm-lock.yaml, playwright.config.ts
tests/e2e/support/*, tests/e2e/specs/*, tests/tested-modules.test.ts
db/migrations/00NN_drop_billing.sql   new, release 2
```

`src/routeTree.gen.ts` is regenerated by the build and never edited by hand.

## Code style

Follow [CODE_STANDARDS.md](../CODE_STANDARDS.md): descriptive names, `/** */` comments, and no `any`. Removing a gate
means removing the branch, not hard-coding the answer. Don't leave `const pro = true`, a `plan: 'pro'` field, or a
`canUse` that always returns true.

Before:

```ts
export const handleTranslate = (request: Request, options: LookupOptions = {}) =>
  lookups.post(
    request,
    {
      log: 'translate',
      body: { json: TRANSLATE_BODY_BYTES },
      before: ({ session }) => requirePro(session, 'translate') ?? undefined,
      parse: parseTranslateInput,
    },
```

After:

```ts
export const handleTranslate = (request: Request, options: LookupOptions = {}) =>
  lookups.post(
    request,
    {
      log: 'translate',
      body: { json: TRANSLATE_BODY_BYTES },
      parse: parseTranslateInput,
    },
```

And for limits, use the single constant directly:

```ts
const started = await startAudiobook(db, userId, book, new Date(), MAX_BOOKS)
if (!started.ok) return fail(409, 'quota', { scope: started.quota, max: started.max })
```

When a function's names are touched and some are unclear, rename them in a separate commit, as CODE_STANDARDS.md says.

## Testing strategy

- **Unit (Vitest, `pnpm check`):** the client message and problem modules keep one quota message, and their tests
  lose the Free cases. `config.test.ts` loses the billing cases and gains one: a config with leftover `PADDLE_*`
  values parses, and has no billing field.
- **Database (`pnpm test:db`):** for each gated server handler, a member with no grant gets the feature. Quota tests
  check the former Pro limits. A deletion test deletes an account without calling anything outside the database.
  `migrations.db.test.ts` gains a case for release 2: after the drop migration, `subscriptions`, `paddle_events`,
  `users.pro_granted_at` and `users.pro_granted_by` are gone, and the existing users, books and audit events are
  untouched.
- **End to end (`pnpm e2e:local`):** the existing specs for Ask, Flashcards, Run code, Audiobooks, Export and
  Translate run as a plain member. `home.spec.ts` checks there is no pricing section and no price. `account.spec.ts`
  checks there is no plan section. A short check confirms that `/account/plan`, `/refunds` and `/billing/paddle`
  answer 404.
- **Leftover check:** the `git grep` in Commands prints nothing outside `spec/` and the two old migrations.
- **Known flaky specs:** `sync.spec.ts:105` on phone and `ask-prompts.spec.ts:88` on desktop. Rerun them before
  debugging.

## Boundaries

- **Always:**
  - remove the gate's branch, not just its result;
  - keep each feature's other checks: own key, rate limits, quotas and disk space;
  - ship the drop migration in its own release, after release 1 is live on production;
  - run `pnpm check`, `pnpm test:db` and `pnpm e2e:local` before calling a release done.
- **Ask first:**
  - changing any limit's value. That's `instance-limits`;
  - rewriting Terms or Privacy beyond removing the billing parts. That's `legal-and-attribution`;
  - deleting rows from `audit_events`;
  - touching `user_books.starter` or `users.starter_book_at`;
  - lowering a coverage floor.
- **Never:**
  - edit `0018_plans.sql`, `0019_billing.sql` or any applied migration;
  - drop the billing tables in the same release as the code change;
  - leave a feature flag, a constant plan or an always-true `canUse` in place of the removed gate;
  - close or change the Paddle account, the server's env or its credentials. Those are the owner's steps.

## Success criteria

- [x] The leftover `git grep` in Commands prints nothing.
      Met as [the tasks](../tasks/billing-removal-todo.md) define it: it prints only the hits that check the removal
      (the 404 test, the leftover `PADDLE_*` config case, the drop migration and its test), plus `tasks/` and
      `.gitleaks.toml`, which the tasks' version of the command excludes.
- [x] `@paddle/paddle-js` isn't in `package.json` or `pnpm-lock.yaml`.
- [x] A member account with no grant and no subscription can use Ask, Translate, Export, Audiobooks, ElevenLabs
      voices, Flashcards and Run code, shown by a db or e2e test for each.
- [x] A member can import 25 books, save 500 articles, and add highlights up to `MAX_HIGHLIGHTS_PER_BOOK` and
      `MAX_HIGHLIGHTS_PER_USER`, and the next one gets `409 { error: 'quota', scope, max }` with no `plan` field.
- [x] `POST /api/me` answers `{ username, role, via }`.
- [x] `/account/plan`, `/refunds` and `/billing/paddle` answer 404.
- [x] The home page, the account page, the admin Users page, Terms and Privacy show no price, plan, Pro, Paddle or
      refund.
- [x] Deleting an account makes no outbound HTTP call, and `DeleteResult` has no `billing_failed`.
- [x] The server starts with leftover `PADDLE_*` env vars set.
- [x] Release 1 is live on production before the drop migration is merged.
- [x] After release 2, `\d users` has no `pro_granted_*` column, and `subscriptions` and `paddle_events` don't
      exist, on dev and production.
- [x] `pnpm check`, `pnpm test:db` and `pnpm e2e:local` pass after each release, with no coverage floor lowered.

## Risks

- **Hidden gates.** Some gating may not go through `requirePro` or `canUse`, for example a client check on
  `viewer.plan === 'pro'`. Mitigation: deleting the `Plan` type makes every such check a type error, and the
  leftover `git grep` catches the rest.
- **Coverage totals.** The billing modules are heavily tested, so deleting them may lower the global percentages.
  Mitigation: add tests where coverage is thin; never lower a floor.
- **Open features, open costs.** Every feature that Pro gated runs on the reader's own key or in their browser, so
  there's no new spend on AI. Storage is the exception. Until `instance-limits` ships, every account gets the 8 GB
  audiobook cap. That's acceptable because sign-up stays closed until `go-public`.
- **Paddle retries.** If a webhook destination exists and is still set when release 1 reaches production, Paddle
  retries against a 404 for about two days. Mitigation: the owner checks and removes it first (Cut-over step 4).
- **An unknown API client.** Nothing known reads `plan` from `/api/me` or checks for `403 { error: 'pro' }`. If
  something turns up, it is updated then. The API isn't versioned, and the only account is the owner's.

## Out of scope (deferred)

- Making limits operator config, and a usage section on the account page: `instance-limits`.
- The full Terms and Privacy rewrite, the takedown contact and the source link in the footer:
  `legal-and-attribution`.
- Removing the starter-book leftovers (`user_books.starter`, `users.starter_book_at`, and the code that still counts
  them). They aren't billing, and nothing gives a starter book now that the catalogue is empty.
- Donations or GitHub Sponsors: deferred at the map level.

## Changes to other specs

Made in this session:

- **Capability map:** the Progress row for `billing-removal` is marked approved, and `instance-limits` is next.

Inherited by later specs:

- **`instance-limits`** starts from `MAX_BOOKS`, `MAX_HIGHLIGHTS_PER_BOOK`, `MAX_HIGHLIGHTS_PER_USER` and
  `MAX_ARTICLES`, with no `limitsFor`. It owns any usage display on the account page.
- **`legal-and-attribution`** starts from Terms and Privacy pages that no longer mention billing.
- **`publish-audit`:** the gitleaks allowlist for the fake `pdl_…test…` values stays, because history still has
  them.

## Decisions

- **Delete the plan concept entirely**, rather than fixing every account at Pro. *(2026-11-25)*
- **Drop `plan` from every response**, including `/api/me`, rather than keep a constant `"pro"` for compatibility.
  No known client reads it. *(2026-11-25)*
- **Removed URLs answer 404**, with no redirects. *(2026-11-25)*
- **Minimal Terms and Privacy edits here**, and the rewrite in `legal-and-attribution`. *(2026-11-25)*
- **Keep past `plan.*` and `billing.*` audit rows.** *(2026-11-25)*
- **Ignore leftover `PADDLE_*` config** instead of refusing to start. *(2026-11-25)*
- **Two releases:** code first, then the drop migration once the code is live on production (map Assumption 4).
  *(2026-11-25)*
- **Paddle owner steps are conditional:** each one runs only where its thing exists. *(2026-11-25)*
- **Nothing replaces the pricing section** on the home page. *(2026-11-25)*

## Open questions

None.
