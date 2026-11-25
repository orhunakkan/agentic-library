import { defineConfig } from 'vitest/config'
import { CONTENT_DIR } from './tests/content-folders.ts'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.db.test.ts', '**/*.browser.test.tsx'],
    environment: 'node',
    env: { CONTENT_DIR },
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
