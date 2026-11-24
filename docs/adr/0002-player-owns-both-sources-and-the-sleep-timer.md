# The player owns both sources and the sleep timer

One player module (`src/client/features/player/player.ts`), created outside React, owns read aloud, the audiobook transport, the arbiter and the lock screen; `PlayerProvider` only subscribes. Read aloud and the transport both take the arbiter as a dependency and report starting, playing and closing to it themselves, so no caller has to wrap them. The arbiter is the one owner of the sleep timer: at a chapter's or an episode's end a source asks it (`partEnded`) whether to stop, rather than keeping its own copy. Decided in issues #90 and #96, after a second copy of "stop at end of chapter" drifted from the arbiter's; `tests/seams.test.ts` enforces that only the player creates these parts.

## Consequences

- Inside the player the sources are `'read-aloud'` and `'audiobook'`, but stored audio bookmarks keep their older kinds, `'voice'` and `'episode'`, mapped only where data enters and leaves the player (`bookmarkKind`, `momentOf` and `bookmarkPlay` in `now-playing.ts`). Those literals are deliberate: renaming them means migrating stored data and the bookmark API.
- Signing in or out is an input to the player (`setSignedIn`), which builds read aloud again and closes the book it was reading.
- The rules between the two sources are tested through `createPlayer`, with fake speakers and a fake media element; `PlayerProvider` has no tests of its own.
