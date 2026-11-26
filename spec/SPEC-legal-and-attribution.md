# Spec: legal-and-attribution — V1

Status: approved (2026-11-25)

Module of [capability-map.md](capability-map.md). It depends on `billing-removal` and starts from the Terms and
Privacy pages that module leaves behind, with no billing in them. It uses the Storage section from `instance-limits`.
`contributor-docs` and `go-public` depend on it.

## Objective

Make agenticlibrary.app's legal pages right for a free service that anyone can sign up to, and make it clear where
Folio's code and its parts come from:

1. Rewrite **Terms** and **Privacy** for a free, open sign-up service.
2. Add a **`/copyright`** page that says how to report an uploaded book or article, and what happens next. Give the
   owner a command to find and remove the book a notice is about.
3. Add a **Source code** link to both footers, set by a new optional `SOURCE_URL`.
4. Generate **third-party notices** at build time for the code that is sent to browsers, and link them from Credits.

**Who it's for:**

- **Readers signing up to agenticlibrary.app**, who should know what they agree to and what is kept about them,
  without reading about plans that no longer exist.
- **Rights holders**, who need one place that says how to send a notice and what Folio does with it.
- **The owner, as operator**, who needs a written policy and a tool to act on a notice, and a site that meets the
  licences of the code it ships.
- **Contributors and self-hosters**, who find the code from the footer and see which licences the parts carry.

**What success looks like:** Terms, Privacy and Copyright describe a free service with no plan, price or payment. Every
fact they state about data matches what the code keeps. A rights holder can send a complete notice using only the
`/copyright` page, and the owner can find and remove the book it's about with one command, which is logged. With
`SOURCE_URL` set, both footers link to the code. With it unset, there's no link and no dead link.
`/third-party-licenses.txt` lists every package in the browser code, with its licence text, and the build fails if a
package has none.

**This is not legal advice.** The page text in this spec was drafted by Claude, not reviewed by a lawyer. The owner
may want a review before `go-public` (see Cut-over).

## What the code does today

Facts gathered 2026-11-25. This module starts after `billing-removal`, so the "Free and Pro" and "Paying for Pro"
parts of the Terms, the plan and subscription lines in Privacy, `/refunds` and the footers' Refunds link are already
gone.

- **Legal pages** are [terms.tsx](../src/routes/terms.tsx) and [privacy.tsx](../src/routes/privacy.tsx). They're built
  from `LegalPage`, `Part` and `Contact` in [LegalPage.tsx](../src/client/components/LegalPage.tsx), and their dates
  are `TERMS_UPDATED` and `PRIVACY_UPDATED` in [site.ts](../src/shared/lib/site.ts). Each loads `getSiteContact()`,
  which is [functions.ts](../src/server/functions.ts) returning `getConfig().siteContact`.
- **The operator is hard-coded.** Both pages say "Folio is run by Orhun Akkan". Privacy names Cloudflare, Resend, a
  14-day access log and "no backups yet", which are facts about agenticlibrary.app's infrastructure, not the code.
- **`SITE_CONTACT`** is an email address or an `https://` URL of at most 200 characters (`parseSiteContact` in
  [config.ts](../src/server/config.ts)). Production with `SIGNUP=open` refuses to start without it. Without it,
  `Contact` prints "ask the site's owner".
- **What the Terms say now** (after `billing-removal`): who runs Folio, the "Using Folio" rules (one person per account,
  upload only what's yours to upload, nothing illegal, Folio may close abusive accounts), no warranty, changes, and
  contact. There's nothing about copyright notices, ending the service, liability, age, or who owns the uploads.
- **What Privacy says now:** the data list is detailed and accurate. It has no legal basis for keeping the data, no
  list of rights, and nothing about legal notices. "Reading without an account" assumes a catalogue of books, but the
  hosted catalogue is empty (map: *Built-in catalogue*).
- **Uploads are private.** A reader's books, audiobooks and articles can only be seen by their account, and nothing is
  shared or public. So a rights holder can't point to a URL. A notice can only name a title, an author, or a username
  if they know it.
- **There's no tool to remove one reader's book.** `scripts/db/users.ts` can disable or delete a whole account.
  Deleting a book is `deleteBook` in [user-books.ts](../src/server/user-books.ts), followed by `forgetBookAudio` in
  [audiobooks/files.ts](../src/server/audiobooks/files.ts) and a `book.deleted` audit event
  ([book-actions.ts](../src/server/book-actions.ts)).
- **Footers.** [SiteFooter.tsx](../src/client/components/SiteFooter.tsx) links Library, About, Privacy, Terms and
  Credits. [HomeFooter.tsx](../src/client/features/home/HomeFooter.tsx) links Library, Privacy, Terms and Sign in. It
  has no Credits link, and it prints "© 2026 Orhun Akkan". Both print `SITE_CREDIT`, "Books are in the public domain
  or shared under open licences; each book's page credits its source. A book without its own cover gets a generated
  one." That isn't true of an empty catalogue with private uploads.
- **Root loader data.** `getNavData()` feeds the root route, and the result is cached for offline use (`readNav`,
  `EMPTY_NAV` in [__root.tsx](../src/routes/__root.tsx)). The SPA shell is prerendered at build time.
- **Licence notices in the browser bundle.** Of the built chunks in `dist/client/assets`, only 2 keep any licence
  comment, so React, TanStack and the rest go to browsers without their notices. Engine files (`pyodide`,
  `@sqlite.org/sqlite-wasm`) are copied into the client output after `vite build` by
  [engine-files.ts](../scripts/run-code/engine-files.ts), so they aren't in Vite's module graph.
- **[credits.tsx](../src/routes/credits.tsx)** credits each Folio voice's dataset and licence, and the voice software
  (`ENGINE_SOFTWARE` in [folio-voices.ts](../src/shared/read-aloud/folio-voices.ts)).
- **A GPL-3.0 part in the browser code.** `@diffusionstudio/piper-wasm` says `"license": "MIT"` in its
  `package.json`, but it ships no licence file. Its build is espeak-ng and piper-phonemize compiled to WebAssembly,
  and both are GPL-3.0. Credits already says GPL-3.0 and links their source. `piper.worker.ts` imports it, so it
  goes to every browser that downloads the Folio voice. The map's Licence row says every dependency is permissive,
  and this one isn't (see Risks and Decisions).

## What changes

### 1. Terms

Same route and components. The lead becomes "The terms for using Folio at this site." `TERMS_UPDATED` is set to the
release date. The parts, in order:

| Id | Title | Says |
|---|---|---|
| `who` | Who runs Folio | Folio at agenticlibrary.app is run by Orhun Akkan as a free service. Folio's code is open source under the MIT licence. These terms cover using this site, not the code, whose licence is in its repository (linked when `SOURCE_URL` is set). |
| `free` | Free, with limits | Folio costs nothing, and there's no paid plan. Each account has storage limits, which the Storage section of your account page shows. They may change, and a lower limit never deletes what you already have. |
| `account` | Your account | You must be 16 or older. An account is for one person, so don't share it or its password. Keep your email address one you can receive mail at. |
| `content` | What you upload | You keep every right you have in what you upload. You let Folio store it, show it to you, and send passages to the AI and voice providers you choose, only to run the features you use. Your uploads stay private to your account, and Folio doesn't look at them, except as the Copyright page describes. |
| `use` | Using Folio | Today's rules, plus: don't use Folio as general file storage, don't make accounts in bulk or by script, and don't try to break or overload the service. |
| `copyright` | Copyright | Only upload what you have the right to. Folio removes books and articles named in a valid notice, and closes accounts that get repeated notices. Links to [/copyright](#3-copyright-page). |
| `providers` | Your own API keys | Ask, Translate and ElevenLabs run on your keys, under your own agreements with those providers. |
| `ending` | Ending | You can delete your account at any time. Folio may close an account that breaks these terms. Where it can, Folio says why first and gives you time to download your data, but not for illegal content. If Folio ever closes, the site says so, and readers with an address are emailed, at least 30 days before, so you can download everything. |
| `warranty` | No warranty | Today's text: provided as it is, keep your own copies. |
| `liability` | Liability | As far as the law allows, Folio isn't liable for lost data or for indirect loss from using it. Nothing here limits liability that the law doesn't let anyone limit. |
| `changes` | Changes | Today's text, plus: a change that takes away something you rely on is announced on the site at least 14 days before it applies. |
| `contact` | Questions | Today's `Contact`. |

There's no governing-law clause (see Decisions).

### 2. Privacy

Same route and components. `PRIVACY_UPDATED` is set to the release date. The changes:

- **`without-account` becomes `visiting`, "Visiting Folio".** It says no cookie is set before you sign in, explains
  Cloudflare and the 14-day access log, and says settings and reading places stay in the browser. It no longer
  suggests that there are books to read without an account. The download and Folio voice paragraphs stay, worded for
  any book you open.
- **`with-account`** keeps today's list, minus what `billing-removal` already removed. It adds that signing up on this
  site needs an email address, which Folio confirms with a link.
- **New `why`, "Why Folio keeps it".** Folio keeps your account and what you add to run the service you asked for. It
  keeps sessions, sign-in attempts and the activity log to keep accounts safe and stop abuse. It keeps records of
  legal notices because the law asks for them. Nothing is used for anything else.
- **New `notices`, "Legal notices".** Folio doesn't browse anyone's library. To act on a copyright or other legal
  notice, the operator may search book titles and authors across accounts, and remove the book the notice names. Each
  search and each removal is recorded in the activity log, with the reason, for a year. The notice and the replies
  are kept as email for as long as they're needed, and at most 3 years. If your book is removed, you're told what was
  removed and why, and who sent the notice, unless the law forbids it.
- **`who-else`** adds: Folio gives your data to no one else, unless the law requires it. Folio's code is public, and
  your data isn't part of it.
- **`choices` becomes `rights`, "Your choices and rights".** Today's text, plus the rights a reader has: to get a
  copy (the download), to correct (account page), to delete (account page), to object to or restrict a use (write
  to the contact), and to complain to the data protection authority where you live.
- `children` and `questions` are unchanged.

### 3. Copyright page

New route `src/routes/copyright.tsx`, built like Terms. Its lead is "How to report a book or article on Folio that
you think infringes your copyright, and what happens next." It adds `COPYRIGHT_UPDATED` to `site.ts`. Its parts:

| Id | Title | Says |
|---|---|---|
| `what` | What's on Folio | Readers upload books, audiobooks and articles to their own private library. Nobody else can see them, and Folio doesn't review uploads. |
| `notice` | Sending a notice | Write to `Contact` with: your name and how to reach you; the work you own; what on Folio you believe copies it, such as the title and author as uploaded, the username or the article's address, whatever you know; a statement that you believe in good faith the use isn't allowed by you, your agent or the law; a statement that the notice is accurate and that you own the right or may act for its owner; and your signature, which can be your typed name. |
| `next` | What Folio does | Folio replies to say it got the notice. If the notice is complete, Folio removes what it names, and tells the reader who uploaded it what was removed, why, and who sent the notice. Removal deletes the copy on Folio, and the reader still has their own file. An incomplete notice gets a reply saying what's missing. |
| `mistake` | If yours was removed by mistake | Reply to Folio's message saying why. Folio passes it to the sender. If the sender withdraws, or the matter ends in your favour, you may upload the book again. |
| `repeat` | Repeated notices | Folio closes an account after its third valid notice. |
| `false` | False notices | Knowingly sending a false notice or reply may make you liable for the harm it causes. |
| `other` | Other illegal content | Report anything else you believe is illegal to the same contact, saying what it is and why. Folio handles it the same way. |
| `code` | Folio's own code and voices | This page is about uploads. Folio's code and the parts it uses are credited on Credits, and in the source repository when `SOURCE_URL` is set. |

The page is public, cached like Terms, and listed with the other legal pages in `private-pages.test.ts`. The required elements cover what both a US DMCA notice (17 U.S.C.
§512(c)(3)) and an EU Digital Services Act notice (Art. 16) ask for, so the page doesn't name a jurisdiction.

### 4. Operator tool: `scripts/db/books.ts`

The tool runs only on the server, through the same `getDb()` as `scripts/db/users.ts`:

```
node scripts/db/books.ts find <text> --reason <text>
    Books, audiobooks and articles whose title or author contains <text>, ignoring case, across every account.
    Prints id, username, kind, title, author and when it was added. Records book.searched with the text and reason.
node scripts/db/books.ts remove <book-id> --reason <text>
    Deletes the book through deleteBook and forgetBookAudio, exactly as the reader's own delete does.
    Records book.removed with the book id, title, owner and reason. Prints the owner's username and confirmed
    email address, if any, so the operator can write to them.
```

`--reason` is required for both commands, such as `--reason "notice 2026-12-01 from Example Press"`. `book.searched`
and `book.removed` are added to `AuditEvent`. The activity log already keeps events for a year. There's no web UI,
because notices are rare and the CLI keeps the search off the network. Emailing the reader is a manual step for the
owner in V1.

### 5. Source link

- **New optional setting `SOURCE_URL`:** an `https://` URL of at most 200 characters. It's checked by the same rule
  as the URL form of `SITE_CONTACT`, which moves into a shared `parseHttpsUrl` helper. A bad value is a `ConfigError`,
  and unset means `sourceUrl: null`.
- `getNavData()` adds `sourceUrl`, so it reaches both footers through the root loader data and is cached offline.
  `EMPTY_NAV` has `sourceUrl: null`. The prerendered shell must not bake in a build-time value: the shell is built
  with `SOURCE_URL` unset, and the nav data that's loaded later fills it in.
- **Both footers** show "Source code" (`data-key="source"`) after the legal links when `sourceUrl` is set, as an
  external link with `rel="noopener"`. With it unset, nothing is shown.
- The Terms' `who` part and the Copyright page's `code` part link it in the same way.

### 6. Footers and credit line

- `SITE_CREDIT` becomes "Books you upload stay private to your account. A book without its own cover gets a generated
  one." Each catalogue book's page already credits its source, so the footer doesn't need to.
- **Both footers** link Privacy, Terms, Copyright and Credits, then Source code when it's set. HomeFooter gains
  Credits and Copyright. SiteFooter gains Copyright.
- "© 2026 Orhun Akkan" stays.

### 7. Third-party notices

- **A Vite plugin**, `thirdPartyNotices()` in `scripts/build/third-party-notices.ts`, runs on the client build only.
  In `generateBundle` it reads the module ids of every chunk and drops `?url`-style queries. It keeps the ids under
  `node_modules` and finds each one's package root, which is the nearest `package.json` with a `name`. It adds the
  `ENGINES` packages from [engines.ts](../src/shared/run-code/engines.ts), because their files are copied after the
  build.
- For each package it records the name, the version, the `license` field, and the text of every `LICENSE*`,
  `LICENCE*`, `COPYING*` and `NOTICE*` file in its root.
- **A package with no licence file fails the build,** unless it's listed in `scripts/build/licence-overrides.ts`
  with a reason and a vendored text under `scripts/build/licences/`. The one known override is
  `@diffusionstudio/piper-wasm`: GPL-3.0 for its espeak-ng and piper-phonemize parts, with a link to their source.
- It writes `third-party-licenses.txt` to the client output's root, sorted by package name, with no timestamps, so
  the same lockfile gives the same file. A short header says that Folio's own code is MIT, names the source when it's
  known, and lists the GPL-3.0 parts.
- The file is served at `/third-party-licenses.txt` with the ordinary short cache from `headersFor`, since its name
  isn't hashed.
- **Credits** gains a part `software`, "Software Folio is built on", that links to the file and says Folio's own
  code is MIT.

### 8. Notes for self-hosters

- `terms.tsx`, `privacy.tsx`, `copyright.tsx` and the © line in `HomeFooter.tsx` each get a `/** … */` comment at the
  top. It says the text is agenticlibrary.app's own, and that anyone who runs Folio for other people must rewrite it
  for their own service.
- `contributor-docs` turns that into a README section and adds `SOURCE_URL` to `.env.example` (see Changes to other
  specs). This module doesn't write those files.

## Cut-over

1. Merge sections 1 to 8 after `billing-removal` and `instance-limits` are live. With `SOURCE_URL` unset, no source
   link shows. CI goes green and it deploys to dev.
2. **Owner, before `go-public` (map Assumption 5):**
   - read Terms, Privacy and Copyright on dev. Optionally have a lawyer review them;
   - make sure someone reads the `SITE_CONTACT` inbox, since notices now go there;
   - optional: if you want the US DMCA safe harbour, register a designated agent with the US Copyright Office (online,
     $6, renewed every 3 years), and add the agent's name to the Copyright page's `notice` part.
3. **`go-public`**, once the new public repo exists, sets `SOURCE_URL=https://github.com/orhunakkan/agentic-library` in
   the dev and production env files, restarts, and checks that both footers' Source code link opens the repo.

## Commands

```
pnpm check                                    Lint, types, unit tests
pnpm test:db                                  Database tests (scripts/db/books.ts)
pnpm test:browser                             Component tests (legal pages and footers)
pnpm build && head -40 dist/client/third-party-licenses.txt
                                              Notices are generated; the build fails on a package with no licence
SOURCE_URL=http://example.org pnpm dev        Should refuse to start, naming SOURCE_URL
git grep -niE 'public domain or shared|run by Orhun' -- src ':!src/routes/terms.tsx' ':!src/routes/privacy.tsx'
                                              Leftover check; expected to print nothing
```

## Files

```
src/routes/terms.tsx, privacy.tsx        rewritten (sections 1, 2); self-hoster comment
src/routes/copyright.tsx                 new (section 3)
src/routes/credits.tsx                   "Software Folio is built on" part
src/shared/lib/site.ts                   SITE_CREDIT, TERMS_UPDATED, PRIVACY_UPDATED, COPYRIGHT_UPDATED
src/client/components/SiteFooter.tsx     Copyright, Source code
src/client/features/home/HomeFooter.tsx  Copyright, Credits, Source code
src/server/config.ts                     SOURCE_URL, parseHttpsUrl (+ config.test.ts)
src/server/functions.ts / nav data       sourceUrl in getNavData, EMPTY_NAV
src/routes/__root.tsx                    passes sourceUrl to SiteFooter
src/server/audit.ts                      book.searched, book.removed
scripts/db/books.ts                      new (+ books.db.test.ts)
scripts/build/third-party-notices.ts     new Vite plugin (+ test, with fixture packages)
scripts/build/licence-overrides.ts       new
scripts/build/licences/GPL-3.0.txt       vendored licence text
vite.config.ts                           registers thirdPartyNotices()
src/server/private-pages.test.ts         /copyright public
src/routes/*.browser.test.tsx            new: Terms, Privacy, Copyright, Credits
src/client/**/*Footer.browser.test.tsx  new: both footers, with and without SOURCE_URL
```

## Code style

Follow [CODE_STANDARDS.md](../CODE_STANDARDS.md): descriptive names, `/** */` comments, and no `any`. Treat
`package.json` contents as `unknown` and narrow them. Config follows the existing parsers:

```ts
/** An https:// URL of at most 200 characters, or null when unset. Shared by SITE_CONTACT and SOURCE_URL. */
function parseHttpsUrl(value: string | undefined, name: string): string | null {
  const text = value?.trim()
  if (!text) return null
  if (text.length <= 200 && /^https:\/\/\S+$/.test(text) && URL.parse(text)?.protocol === 'https:') return text
  throw new ConfigError(`${name} must be an https:// URL of at most 200 characters`)
}
```

Legal copy uses the existing `Part` and `Contact`, in short, plain sentences like today's pages:

```tsx
<Part id="repeat" title="Repeated notices">
  <p>Folio closes an account after its third valid notice.</p>
</Part>
```

When a function's names are touched and some are unclear, rename them in a separate commit, as CODE_STANDARDS.md says.

## Testing strategy

- **Unit (Vitest, `pnpm check`):**
  - `config.test.ts`: `SOURCE_URL` unset gives `null`, and a valid value is kept. `http://…`, a bare host, a value
    over 200 characters and a value with spaces are refused, naming `SOURCE_URL`. The existing `SITE_CONTACT` cases
    still pass after the helper is shared.
  - `third-party-notices.test.ts`, run on fixture packages: a module id with `?url` maps to its package, and a
    scoped package resolves to its root. Licence files are found under every name pattern. A package with no licence
    and no override throws, naming the package. An override supplies its text. The output is sorted and the same on
    every run.
- **Database (`pnpm test:db`):** `books.db.test.ts` checks that `find` matches title and author ignoring case across
  two accounts, and records `book.searched` with the reason. `remove` deletes the book, its pages and pictures,
  records `book.removed`, and returns the owner's username and address. Both refuse to run without `--reason`, and
  removing a missing id changes nothing.
- **Component (`pnpm test:browser`):** Vitest is the only test tool; the Playwright suite was removed on 2026-11-26.
  - Terms, Privacy and Copyright each show their parts by id, the contact link from `SITE_CONTACT`, and none of
    "Pro", "Paddle", "price", "subscription" or "refund". Copyright lists the six notice elements. Credits links
    `/third-party-licenses.txt`.
  - Both footers show the new `SITE_CREDIT` and the Copyright, Credits and Source code links when `SOURCE_URL` is set,
    and no Source code link when it isn't.
- **Build:** CI already runs `pnpm build`, which now fails on a package with no licence.
- **Coverage floors don't go down.**

## Boundaries

- **Always:**
  - state only data facts that the code makes true. When a page and the code disagree, fix the page or ask;
  - reach every contact through `SITE_CONTACT` and `Contact`, never a hard-coded address;
  - require `--reason` for, and log, every search or removal across accounts;
  - move a page's `*_UPDATED` date whenever its text changes.
- **Ask first:**
  - adding a governing-law or jurisdiction clause;
  - a "disabled" state for books instead of deletion, which would need a schema change;
  - a web UI for searching or removing other readers' books;
  - adding a dependency, such as a licence-collecting Vite plugin, instead of the small plugin above;
  - changing the 16+ age, the 30-day closing notice, the 14-day change notice or the three-notice rule.
- **Never:**
  - let the operator read a book's contents through the new tool. It prints titles and authors, nothing else;
  - show a Source code link that points to a private or missing repo;
  - ship a package in the browser code without its licence text;
  - write `.env.example` or the README. That's `contributor-docs`;
  - change the server's env files. That's the owner's step and `go-public`'s.

## Success criteria

- [ ] Terms have the twelve parts in section 1, and Privacy has the changes in section 2. Neither mentions a plan,
      price, payment, Paddle or refund.
- [ ] `/copyright` is public, linked from both footers and from the Terms, and lists the six notice elements, removal,
      the mistake route, the three-notice rule and other illegal content.
- [ ] Every data fact on Privacy matches the code, including the new search and removal logging.
- [ ] `scripts/db/books.ts find` and `remove` work as in section 4, refuse to run without `--reason`, and write
      `book.searched` and `book.removed`.
- [ ] With `SOURCE_URL` set, both footers, the Terms and the Copyright page link it. With it unset, none do. A bad
      value stops the server, naming `SOURCE_URL`.
- [ ] `SITE_CREDIT` no longer claims the books are public domain. HomeFooter links Credits and Copyright.
- [ ] `pnpm build` writes `dist/client/third-party-licenses.txt`, which covers every `node_modules` package in the
      client chunks and the engine packages. A package with no licence fails the build. Credits links the file.
- [ ] The legal pages and HomeFooter carry the self-hoster comment.
- [ ] `pnpm check`, `pnpm test:db`, `pnpm test:browser` and `pnpm build` pass, with no coverage floor lowered.
- [ ] After `go-public` sets `SOURCE_URL`, both footers' Source code link opens the public repo on dev and production.

## Risks

- **The GPL-3.0 voice parts.** espeak-ng and piper-phonemize are GPL-3.0 and go to browsers inside the Folio voice
  worker. Folio's own code can stay MIT. Shipping GPL code means offering its source, which Credits does and the
  notices file will. But a fork that's sold or closed can't simply keep this part closed, and the map's "all
  dependencies are permissive" is wrong. Mitigation: the notices file names the GPL parts and their source, and the
  map's Licence row now says so (see Decisions).
- **Copy that isn't reviewed by a lawyer.** Mitigation: Cut-over step 2 suggests a review before `go-public`, and
  the pages use plain claims that match the code, with no promises the code doesn't keep.
- **Notices to an unread inbox.** A takedown that sits unanswered loses any safe harbour. Mitigation: Cut-over step 2.
- **A self-hoster runs the owner's Terms unchanged**, and their site says it's run by Orhun Akkan. Mitigation: the
  comments in section 8 and the README section from `contributor-docs`. The owner chose not to make the operator
  configurable.
- **The search tool is a privacy-sensitive power.** Mitigation: CLI only, on the server, titles and authors only,
  `--reason` required, and every use logged and described on Privacy.
- **A prerendered shell with a stale `SOURCE_URL`.** Mitigation: the shell is built with it unset, and a component test
  checks the link after the nav data loads.
- **Licence detection misses a package**, such as a nested copy or an asset imported by URL. Mitigation: unit tests
  for `?url` ids and scoped packages, and the build fails on a missing licence rather than skipping the package.

## Out of scope (deferred)

- A governing-law or jurisdiction clause: it depends on where the operator is based, and the owner can add one
  after a legal review.
- Replacing espeak-ng phonemization to drop the GPL-3.0 parts: a bigger change to read aloud, not needed for V1.
- Registering a DMCA agent: an optional owner step, not code.
- A "disabled" state so a removed book can be restored: removal deletes, and the reader keeps their own file.
- Emailing the uploader automatically on removal: the owner writes by hand in V1.
- A web admin UI for notices.
- Deleting inactive accounts.
- A configurable operator name or legal text for self-hosted sites: the owner chose hosted text with a guide.
- Notices for the server bundle: it runs on the operator's machine and isn't given to anyone.
- A cookie banner: Folio sets only the sign-in cookie, which needs no consent.

## Changes to other specs

Made in this session:

- **Capability map:** the Progress row for `legal-and-attribution` is marked approved, and `contributor-docs` is
  next. The Licence row is corrected to say that the Folio voice includes GPL-3.0 parts (espeak-ng and
  piper-phonemize), shipped with their source offered.

Inherited by later specs:

- **`contributor-docs`** adds `SOURCE_URL` to `.env.example`, with a comment giving the hosted value. It writes a
  README section, "Running Folio for other people", that lists the files to rewrite (`terms.tsx`, `privacy.tsx`,
  `copyright.tsx` and the © line in `HomeFooter.tsx`) and mentions `/third-party-licenses.txt`.
- **`go-public`** sets `SOURCE_URL` on dev and production once the public repo exists, and checks the footer link.
  Before `SIGNUP=open`, it checks that the owner's steps in Cut-over step 2 are done.

## Decisions

- **Legal pages stay agenticlibrary.app's own text.** Self-hosters are told to rewrite them, and there's no operator
  config. *(2026-11-25)*
- **A `/copyright` page, with notices sent to `SITE_CONTACT`.** There's no separate contact setting. *(2026-11-25)*
- **`SOURCE_URL` is optional config, and unset means no link.** So the link never 404s before `go-public`, and a fork
  links its own code. *(2026-11-25)*
- **Third-party notices are generated at build time,** and a package with no licence fails the build. *(2026-11-25)*
- **The GPL-3.0 voice parts are accepted.** espeak-ng and piper-phonemize keep shipping in the Folio voice worker,
  with their source offered on Credits and in the notices file. Folio's own code stays MIT. *(2026-11-25)*
- **No governing-law clause in V1.** It depends on where the operator is based. *(2026-11-25)*

## Assumptions (correct any of these)

1. Removal **deletes** the book. There's no hidden state and no schema change.
2. A **third valid notice** closes the account.
3. Readers must be **16 or older**, which matches the Privacy page's children part.
4. Folio gives **30 days' notice** before it closes, and **14 days** before a change that takes something away.
5. The notice elements cover both the DMCA and the DSA, and the page names **no jurisdiction**.
6. Operator search is **titles and authors only**, through a CLI, with a reason, and logged.
7. Records of legal notices are kept for **at most 3 years**, as email, not in the database.

## Open questions

None.
