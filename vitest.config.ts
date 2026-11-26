import { defineConfig } from 'vitest/config'
import { CONTENT_DIR } from './tests/content-folders.ts'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.db.test.ts', '**/*.browser.test.tsx'],
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
      exclude: ['**/*.test.ts', 'src/client/testing/**'],
      thresholds: { statements: 92, branches: 89, functions: 91, lines: 93 },
    },
  },
})
