import { defineConfig } from 'vitest/config'
import { CONTENT_DIR } from './tests/content-folders.ts'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.db.test.ts'],
    environment: 'node',
    env: { CONTENT_DIR },
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text-summary', ['text-summary', { file: 'summary.txt' }], 'html', 'lcovonly'],
      reportsDirectory: 'coverage/unit',
      include: ['src/shared/**/*.ts', 'src/client/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: { statements: 90, branches: 88, functions: 89, lines: 91 },
    },
  },
})
