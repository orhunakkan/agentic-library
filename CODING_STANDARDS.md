# Coding standards

Read during review. Each rule is a judgement call that no check enforces. Mechanical rules live as checks instead: architectural seams in `tests/seams.test.ts`, the Node-run import shape in `tests/node-imports.test.ts`, comments written as `/** … */` in `tests/comments.test.ts`, formatting and lint in `biome.json`.

## Ask a module's own question

When a module exports a named guard, call it rather than reaching through its parse: `isCatalogueBookSlug(slug)`, not `parseBookSlug(slug)?.kind === 'catalogue'`. Pick the guard whose meaning fits. A sweep that clears private data must over-match (`hasPrivateSlugPrefix`); a check that grants access must be exact (`isPrivateBookSlug`).

## Build fixtures with the domain's own codec

A test builds a domain value the way the app does: `privateBookSlug(id)`, `slugOf(ref)`, `threadKey(slug)`. Hand-written strings are only for inputs the test expects to be rejected (`'u-not-a-uuid'`), and those should be visibly invalid.

## Match the file's import style

A file's imports follow one style. Files that Node runs (reached from `scripts/`) use relative `.ts` paths, and `tests/node-imports.test.ts` enforces that. Elsewhere, a new import copies the style the file already uses, alias or relative.

## Name things with the glossary

Use the terms in `GLOSSARY.md` for names, test titles and comments, and the words it lists under _Avoid_ nowhere.
