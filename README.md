# Folio

Folio is a calm place to read on any screen. Have any page read aloud, keep your highlights in one place, and ask
questions that only see the pages you’ve read.

It’s free to use at [agenticlibrary.app](https://agenticlibrary.app), and open source under the [MIT licence](LICENSE).

## What Folio does

- **Read aloud.** Any book can be read aloud by your device’s own voices, with each sentence marked as it’s spoken. The
  page turns by itself, and the reading carries on while you browse the library.
- **Ask the book.** With an account, ask about what you’re reading and get answers from the book itself, each with a
  link to the page it came from (page links need a Claude model). It only sees the pages you’ve read, unless you ask
  it to use the whole book.
- **Explain and recap.** Select a passage to have it explained, or ask for a recap of the story so far.
- **Highlights and notes.** With an account, highlight a passage in one of four colours and add a note to it. Highlights follow you to
  every device and gather on one page, and every book’s highlights export as one Markdown file.
- **Bookmarks**, with an account, for the pages you want to come back to.
- **Your own books.** With an account, import an EPUB, a Markdown file or a ZIP of Markdown. Your browser reads the file, and the book is
  yours alone: no one else can open it.
- **Read your way.** Light, sepia or dark pages, five reading fonts, and your own type size, line spacing, column width,
  and turning or scrolling pages. With an account, your theme, font, line spacing and column width follow you to every
  device.
- **Your own API key.** The AI features (Ask the book, Explain, recaps) run on the reader’s own Anthropic or OpenAI key,
  which they save in the app. Folio has no AI key of its own, and adds no charge.

## Quick start

You need Node 26 or newer, pnpm 12 (the version in `packageManager` in [package.json](package.json); see
[pnpm’s installation page](https://pnpm.io/installation)), and Docker with Compose, or your own Postgres 18.

```sh
git clone https://github.com/orhunakkan/agentic-library.git folio && cd folio
pnpm install
docker compose up -d --wait                 # Postgres on 127.0.0.1:5432
cp .env.example .env
openssl rand -base64 32                     # paste the output after KEK= in .env
pnpm db:migrate
pnpm db:users create <your-name> --role admin   # prints your password once
pnpm dev                                    # http://localhost:3000
```

Then sign in at http://localhost:3000/login with that name and password. Any 32 random bytes in base64 work as `KEK`,
if you don’t have `openssl`. If port 5432 is already taken, see [CONTRIBUTING.md](CONTRIBUTING.md#setup).

## Configuration

[.env.example](.env.example) lists every setting the server reads, with what it does, its default and the value
agenticlibrary.app uses. The server refuses to start, naming the setting, when a value is wrong. In production
(`NODE_ENV=production`) it needs these three:

| Setting | What it is |
|---|---|
| `DATABASE_URL` | The Postgres database, as `postgres://user:password@host:port/name` |
| `KEK` | 32 random bytes in base64 (`openssl rand -base64 32`), which encrypt the API keys readers save |
| `APP_ORIGIN` | The site’s own origin, such as `https://agenticlibrary.app` |

Keep secrets out of the environment with systemd credentials: with `LoadCredential=`, the server reads `kek`,
`kek_previous`, `resend_api_key`, `resend_webhook_secret` and `github_token` from the credentials directory instead of
the matching variables.

## Limits

Each account’s storage is limited by six settings. The defaults apply when a setting is unset, and the account page’s
Storage section shows the limits in effect.

| Setting | What it limits | Default | agenticlibrary.app |
|---|---|---|---|
| `LIMIT_USER_AUDIO` | Audiobook storage per user, all audiobooks combined | `8GB` | `1GB` |
| `LIMIT_AUDIOBOOK_SIZE` | The size of one audiobook | `2GB` | `1GB` |
| `LIMIT_USER_PICTURES` | Picture storage per user, books and articles combined | `250MB` | `100MB` |
| `LIMIT_BOOKS` | Books per user, audiobooks included | `25` | `25` |
| `LIMIT_ARTICLES` | Saved articles per user | `500` | `500` |
| `LIMIT_ARTICLE_TEXT` | The stored text of one article | `1MB` | `1MB` |

Sizes take a unit (`KB`, `MB` or `GB`) and are binary, so `1GB` is 1024³ bytes. A bare number is refused for a size,
so `LIMIT_USER_AUDIO=1` can’t mean one byte. `LIMIT_AUDIOBOOK_SIZE` can’t be larger than `LIMIT_USER_AUDIO`, and
`LIMIT_ARTICLE_TEXT` can’t be larger than `8MB`. See [SPEC-instance-limits.md](spec/SPEC-instance-limits.md) for the
details.

## Running in production

There’s no production container yet, so Folio runs from source, with Node 26:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate
pnpm voices:fetch
NODE_ENV=production pnpm start
```

- `pnpm voices:fetch` downloads the Folio voice’s files to `VOICES_DIR`.
- `pnpm start` listens on `HOST` and `PORT` (`127.0.0.1:3000` by default). Put a reverse proxy that terminates TLS in
  front of it.
- If migrations connect as a different role from the one that should own the tables, set `DB_OWNER_ROLE`.

## Running Folio for other people

The legal text is agenticlibrary.app’s own. Before you open your copy to other people, rewrite these for your own
service:

- [src/routes/terms.tsx](src/routes/terms.tsx);
- [src/routes/privacy.tsx](src/routes/privacy.tsx);
- [src/routes/copyright.tsx](src/routes/copyright.tsx);
- the © line in [src/client/features/home/HomeFooter.tsx](src/client/features/home/HomeFooter.tsx).

Then:

- Set `SITE_CONTACT` to where readers can reach you, and `SOURCE_URL` to your copy of the code, which the footers link.
- `SIGNUP=open` needs mail (`MAIL_TRANSPORT`), and in production `SITE_CONTACT` too.
- `/third-party-licenses.txt` lists the licences of the code sent to browsers. `pnpm build` writes it, and names your
  source in it when `SOURCE_URL` is set for the build as well.

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) says how to set up, test and send a pull request. Everyone
taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as
[SECURITY.md](SECURITY.md) describes, not in an issue.

## Licence

Folio is released under the [MIT licence](LICENSE).

The Folio voice’s worker includes espeak-ng and piper-phonemize, compiled to WebAssembly, which are under the GPL-3.0.
Their source is offered on the site’s Credits page and in `/third-party-licenses.txt`. Folio’s own code stays MIT.
