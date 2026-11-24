# Coding standards

Read during review. Each rule is a judgement call that no check enforces. Mechanical rules live as checks instead: architectural seams in `tests/seams.test.ts`, the Node-run import shape in `tests/node-imports.test.ts`, comments written as `/** … */` in `tests/comments.test.ts`, formatting and lint in `biome.json`.

## Ask a module's own question

When a module exports a named guard, call it rather than reaching through its parse: `isCatalogueBookSlug(slug)`, not `parseBookSlug(slug)?.kind === 'catalogue'`. Pick the guard whose meaning fits. A sweep that clears private data must over-match (`hasPrivateSlugPrefix`); a check that grants access must be exact (`isPrivateBookSlug`).

## Build fixtures with the domain's own codec

A test builds a domain value the way the app does: `privateBookSlug(id)`, `refFor(slug)`, `slugOf(ref)`, `threadKey(slug)`. A hand-built book ref is already a seams check. Hand-written strings are only for inputs the test expects to be rejected (`'u-not-a-uuid'`), and those should be visibly invalid.

## Match the file's import style

A file's imports follow one style. Files that Node runs (reached from `scripts/`) use relative `.ts` paths, and `tests/node-imports.test.ts` enforces that. Elsewhere, a new import copies the style the file already uses, alias or relative.

## Take a unit right before the call it pays for

A handler calls `take` after every local refusal (input, ownership, key shape, in-memory pacing) and just before the outside call, so only a request that reaches the call spends a unit of its usage quota; `settle` then records the outcome. Imports and article saves are the exception: their unit is the finished import, checked with `retryAtLocked`.

## Name things with the glossary

Use the terms in `GLOSSARY.md` for new names, test titles, comments and anything a reader sees. An _Avoid_ word is a finding only where the glossary's own qualifier applies (`audio` _as the playback source_), and only in code the diff introduces. Names that already exist (`AudioBook`, `speech-text.ts`) and names the issue specifies are not findings: suggest the rename as a follow-up instead.
