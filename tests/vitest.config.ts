import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { CONTENT_DIR } from './content-folders.ts'

export default defineConfig({
  /** The repo folder, so every path below means the same wherever Vitest is started from. */
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: { tsconfigPaths: true },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/repo/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts', '**/*.browser.test.tsx'],
    environment: 'node',
    env: { CONTENT_DIR },
    /** A stray `.only` fails the run instead of quietly skipping every other test; Vitest allows it unless CI is set. */
    allowOnly: false,
    /**
     * Files and the tests in them run in a new order each run, so a test that only passes after another one is found.
     * The run prints its seed; replay an order with `--sequence.seed=<seed>`.
     */
    sequence: { shuffle: true },
    /**
     * Before each test, undo every `vi.spyOn`, `vi.stubGlobal` and `vi.stubEnv`, so a test that forgets its cleanup
     * can't leak into the next. Stub in the test or a `beforeEach`: one made at module level or in `beforeAll` is undone
     * before the first test. `clearMocks` is on by default; `mockReset` is left off, as it would wipe what a `vi.mock`
     * factory's `vi.fn()` was given.
     */
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    coverage: {
      enabled: false,
      provider: 'v8',
      reporter: [
        ['text-summary', { file: 'summary.txt' }],
        ['json-summary', { file: 'coverage-summary.json' }],
        'html',
        'lcovonly',
      ],
      reportsDirectory: 'coverage/unit',
      include: ['src/shared/**/*.ts', 'src/client/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: { statements: 92, branches: 89, functions: 91, lines: 93 },
    },
  },
})
