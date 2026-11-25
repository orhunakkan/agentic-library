import viteReact from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/** Component tests: real components in headless Chromium, through the Playwright already installed. No simulated DOM. */
export default defineConfig({
  plugins: [viteReact()],
  resolve: { tsconfigPaths: true },
  /**
   * Pre-bundle every dependency the tests reach before they start, so Vite never reloads the page mid-run. TanStack
   * Start is left out: it needs its own Vite plugin, and tests mock the server functions that import it.
   */
  optimizeDeps: { entries: ['src/**/*.browser.test.tsx'], exclude: ['@tanstack/react-start'] },
  /** Transform a module only when a test loads it, so a mocked server function's real imports are never touched. */
  server: { preTransformRequests: false },
  test: {
    include: ['src/**/*.browser.test.tsx'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
})
