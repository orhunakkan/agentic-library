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
