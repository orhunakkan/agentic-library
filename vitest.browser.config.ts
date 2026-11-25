import viteReact from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/** Component tests: real components in headless Chromium, through the Playwright already installed. No simulated DOM. */
export default defineConfig({
  plugins: [viteReact()],
  resolve: { tsconfigPaths: true },
  /** Pre-bundle every dependency the tests reach before they start, so Vite never reloads the page mid-run. */
  optimizeDeps: { entries: ['src/**/*.browser.test.tsx'] },
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
