import { fileURLToPath } from 'node:url'
import viteReact from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { TRACES_DIR } from './browser-traces.ts'

/** Component tests: real components in headless Chromium, through the Playwright already installed. No simulated DOM. */
export default defineConfig({
  /** The repo folder, so every path below means the same wherever Vitest is started from. */
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [viteReact()],
  resolve: { tsconfigPaths: true },
  /**
   * Pre-bundle every dependency the tests reach before they start, so Vite never reloads the page mid-run. TanStack
   * Start is left out: it needs its own Vite plugin, and tests mock the server functions that import it.
   */
  optimizeDeps: { entries: ['tests/component/**/*.browser.test.tsx'], exclude: ['@tanstack/react-start'] },
  /** Transform a module only when a test loads it, so a mocked server function's real imports are never touched. */
  server: { preTransformRequests: false },
  test: {
    include: ['tests/component/**/*.browser.test.tsx'],
    globalSetup: ['tests/browser-traces.ts'],
    /** A stray `.only` fails the run instead of quietly skipping every other test; Vitest allows it unless CI is set. */
    allowOnly: false,
    /**
     * Before each test, undo every `vi.spyOn`, `vi.stubGlobal` and `vi.stubEnv`, so a test that forgets its cleanup
     * can't leak into the next. Stub in the test or a `beforeEach`: one made at module level or in `beforeAll` is undone
     * before the first test. `clearMocks` is on by default; `mockReset` is left off, as it would wipe what a `vi.mock`
     * factory's `vi.fn()` was given.
     */
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      screenshotFailures: false,
      /**
       * A failed test keeps a Playwright trace in `.vitest/traces/<run's pid>/`, and Vitest copies it to `.vitest/attachments/`; a
       * passing one keeps none. The default place, `__traces__/` beside each test file, would leave a folder named like
       * a test file in `tests/component/`. Playwright writes every test's raw trace files here too, which the global setup clears.
       */
      trace: { mode: 'retain-on-failure', tracesDir: TRACES_DIR },
      instances: [{ browser: 'chromium' }],
    },
    coverage: {
      enabled: false,
      provider: 'v8',
      reporter: [
        ['text-summary', { file: 'summary.txt' }],
        ['json-summary', { file: 'coverage-summary.json' }],
        'html',
        'lcovonly',
      ],
      reportsDirectory: 'coverage/browser',
      /** Components, and the React hooks beside them, which only a browser test can run. */
      include: ['src/client/**/*.tsx', 'src/client/**/use-*.ts'],
      exclude: ['**/*.test.ts', '**/*.test.tsx'],
      thresholds: { statements: 42, branches: 34, functions: 38, lines: 43 },
    },
  },
})
