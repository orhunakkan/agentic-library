# Code standards

## Naming

Use descriptive names. A one-letter name is fine only when every use is within 3 lines of its declaration, as in `books.map((b) => b.id)`. If it's used further away, name it for what it holds, like `book` or `playerState`, not `value` or `data`.

These one-letter names are allowed anywhere, but only for these meanings:

- `i`, `j`, `k`: loop counters and array indexes
- `x`, `y`, `z`: coordinates
- `w`, `h`: width and height
- `a`, `b`: the two sides of a comparison, as in `.sort((a, b) => a.start - b.start)`
- `_`: an unused value
- `T`, `K`, `V`, `P`, `R`, `E`: type parameters

Older code doesn't always follow this rule. When you change a function, rename its unclear names in a separate commit. Use the editor's rename (F2), not find-and-replace.

## Types

Don't use `any`. Use a specific type, or use `unknown` and narrow it before use. Treat the results of `JSON.parse()` and `response.json()` as `unknown`, and check them before relying on their shape.

The only exceptions are generated files such as `src/routeTree.gen.ts`, and test doubles that can't be typed any other way. A test double needs a `biome-ignore lint/suspicious/noExplicitAny:` comment that says why.

## Comments

Write every comment as a `/** … */` block, including one-line notes, and don't use `//` or `/* */`. Tool directives keep the form their tool reads: `// biome-ignore`, `{/* biome-ignore */}` in JSX, `// @ts-expect-error`, `/// <reference>` and `/* @vite-ignore */`. Generated files are left alone. [tests/repo/comments.test.ts](tests/repo/comments.test.ts) enforces this rule.

## Tests

- **New or changed behavior:** write the test first. Run it and see it fail for the reason you expect before you write the code. If a new test passes on its first run, find out why: either the behavior already exists, or the test doesn't check what its name says.
- **Bug fix:** start with a test that reproduces the bug and fails, then fix the bug. The test lands in the same commit as the fix, and the commit message says in a few words how the test failed before the fix, such as the assertion that failed.
- **Level:** test at the lowest level that shows the behavior. That's a unit test in `tests/unit/` (no Postgres, no browser) where possible, then an integration test in `tests/integration/`, then a component test in `tests/component/`.
- **Exceptions:** docs, pure configuration and static content with no behavior need no new test.
