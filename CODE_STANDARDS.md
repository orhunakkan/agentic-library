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
