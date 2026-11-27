import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { CONTENT_DIR } from './content-folders.ts'
import { DATABASE_WORKERS, testDatabaseUrl } from './test-databases.ts'

const FULL = { statements: 100, branches: 100, functions: 100, lines: 100 }

export default defineConfig({
  /** The repo folder, so every path below means the same wherever Vitest is started from. */
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: { tsconfigPaths: true },
  test: {
    /**
     * The integration tests, and the server's unit tests again, which is how `coverage/server` reaches its thresholds.
     * Whether they should run twice is #16's question.
     */
    include: ['tests/integration/**/*.test.ts', 'tests/unit/server/**/*.test.ts'],
    environment: 'node',
    env: { DATABASE_URL: testDatabaseUrl(), CONTENT_DIR },
    /**
     * Files run in parallel, each worker against a database of its own (`agentic_w<id>_test`), which the global setup
     * creates when missing and migrates fresh, and the setup file points the worker at.
     */
    maxWorkers: DATABASE_WORKERS,
    globalSetup: ['tests/support/server/db-global-setup.ts'],
    setupFiles: ['tests/support/server/db-worker.ts'],
    /**
     * Besides the terminal output, each run writes a report to open in a browser: `.vitest/reports/integration/index.html`,
     * one self-contained file, with this run's coverage beside it. The pre-commit hook passes `--reporter=default`, so
     * its partial runs don't replace it.
     */
    reporters: ['default', ['html', { outputDir: '.vitest/reports/integration', singleFile: true }]],
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
    testTimeout: 20_000,
    coverage: {
      enabled: false,
      provider: 'v8',
      reporter: [
        ['text-summary', { file: 'summary.txt' }],
        ['json-summary', { file: 'coverage-summary.json' }],
        'html',
        'lcovonly',
      ],
      reportsDirectory: 'coverage/server',
      include: ['src/server/**/*.ts', 'src/routes/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: {
        statements: 94,
        branches: 93,
        functions: 90,
        lines: 94,
        'src/server/auth.ts': FULL,
        'src/server/sessions.ts': { statements: 95, branches: 90, functions: 100, lines: 100 },
        'src/server/login-attempts.ts': { statements: 96, branches: 90, functions: 100, lines: 100 },
        'src/server/api-keys.ts': FULL,
        'src/server/key-crypto.ts': FULL,
        'src/server/security.ts': FULL,
        'src/server/redact.ts': FULL,
        'src/server/rate-limit.ts': FULL,
        'src/server/quota.ts': FULL,
        'src/server/books/private.ts': FULL,
        'src/server/json-body.ts': FULL,
        'src/server/signed-in.ts': FULL,
        'src/server/articles/address-guard.ts': { statements: 95, branches: 92, functions: 100, lines: 100 },
        'src/server/articles/web-fetch.ts': { statements: 99, branches: 91, functions: 96, lines: 100 },
        'src/server/articles/actions.ts': FULL,
        'src/server/email/store.ts': FULL,
        'src/server/email/actions.ts': { statements: 100, branches: 99, functions: 100, lines: 100 },
        'src/server/mail/mail.ts': { statements: 100, branches: 92, functions: 100, lines: 100 },
        'src/server/mail/resend.ts': { statements: 100, branches: 90, functions: 100, lines: 100 },
        'src/server/mail/signature.ts': FULL,
        'src/server/mail/webhook.ts': FULL,
        'src/server/signup/store.ts': { statements: 98, branches: 92, functions: 100, lines: 100 },
        'src/server/signup/actions.ts': { statements: 98, branches: 94, functions: 100, lines: 100 },
        'src/server/admin/invites.ts': FULL,
        'src/server/speech/actions.ts': { statements: 98, branches: 93, functions: 100, lines: 100 },
        'src/server/speech/elevenlabs.ts': { statements: 100, branches: 96, functions: 84, lines: 100 },
        'src/server/speech/input.ts': FULL,
        'src/server/speech/store.ts': FULL,
        'src/server/current-password.ts': FULL,
        'src/server/passkeys/actions.ts': FULL,
        'src/server/passkeys/ceremony.ts': { statements: 94, branches: 86, functions: 100, lines: 100 },
        'src/server/passkeys/input.ts': { statements: 100, branches: 98, functions: 100, lines: 100 },
        'src/server/passkeys/sign-in.ts': { statements: 97, branches: 94, functions: 100, lines: 100 },
        'src/server/passkeys/store.ts': { statements: 97, branches: 86, functions: 100, lines: 100 },
        'src/server/sign-in.ts': FULL,
        'src/server/access-tokens/input.ts': FULL,
        'src/server/access-tokens/view.ts': FULL,
        'src/server/access-tokens/store.ts': { statements: 97, branches: 86, functions: 100, lines: 100 },
        'src/server/access-tokens/actions.ts': { statements: 97, branches: 96, functions: 90, lines: 100 },
        'src/server/github-repos/markdown.ts': { statements: 99, branches: 99, functions: 100, lines: 100 },
        'src/server/github-repos/input.ts': FULL,
        'src/server/github-repos/github.ts': { statements: 99, branches: 100, functions: 100, lines: 100 },
        'src/server/github-repos/actions.ts': { statements: 99, branches: 96, functions: 100, lines: 100 },
      },
    },
  },
})
