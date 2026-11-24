# Folio

A reading library: public books everyone can read, plus books each person imports privately, with tools for reading, listening and studying them.

## Books

**Book**:
Anything a person can open to read or listen to: either a catalogue book or a private book.
_Avoid_: user book, work, title

**Catalogue book**:
A book published with the library itself, the same for everyone, readable while signed out.
_Avoid_: public book, catalog book

**Private book**:
A book one person imported themselves; only its owner can open it, and only once its import has finished.
_Avoid_: user book, uploaded book, my book

**Book slug**:
The name of a book in links and references: `u-<id>` for a private book, a lowercase hyphenated name for a catalogue book.
_Avoid_: book id, book key

**Chapter slug**:
The name of a chapter inside one book, in reader links (`/read/<book slug>/<chapter slug>`). It shares the book slug's lowercase hyphenated shape but is not a book slug, and may start with `u-`.
_Avoid_: chapter id

**Position**:
Where in a book someone is: a page of a chapter, or a printed page.
_Avoid_: location, place (a place is a highlight's span of text on a page)

## Listening

**Read aloud**:
Spoken playback of a text book, produced by a voice as you listen.
_Avoid_: speech, voice (as the playback source), TTS

**Audiobook**:
Recorded audio of a book, played in episodes.
_Avoid_: audio, episode (as the playback source)

**Voice**:
One text-to-speech voice that read aloud can speak with.
_Avoid_: speaker, narrator

## Usage

**Usage quota**:
How much of one metered action a person may spend in a window of time, such as 60 questions an hour or 150,000 read-aloud characters an hour. Each kind of action has its own. In code, the `quota` module.
_Avoid_: rate limit (a rate limit also guards sign-in by IP); quota alone (it could mean a plan limit)

**Reservation**:
The unit of a usage quota taken before the action is spent, written to the ledger under the person's lock so parallel requests can't both have the last unit. It counts whatever the outcome; the outcome is added to it afterwards.
_Avoid_: booking, hold, credit

**Plan limit**:
How many of something a person may keep at once on their plan: their own books, highlights, saved articles. It caps what is kept, not what is spent over time; fixed caps such as `MAX_REPOS` work the same way. In code, `limitsFor`, `FREE_LIMITS` and `PRO_LIMITS`; older names call it a quota (`bookQuotaCopy`, a `'quota'` refusal) or usage (`usageLine`), so suggest renames as follow-ups.
_Avoid_: quota, usage (in new names; those are a usage quota's words)
