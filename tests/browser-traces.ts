import { mkdirSync, readdirSync, rmdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** Where failed component tests keep their Playwright traces: one gitignored folder, outside `src/`. */
export const TRACES_ROOT = '.vitest/traces'

/**
 * This run's own folder in it, named for the process that runs it, so two browser runs at once (a watch session and
 * a `pnpm test:browser`) never clear each other's files. The config and its global setup run in the same process.
 */
export const TRACES_DIR = join(TRACES_ROOT, String(process.pid))

/**
 * What to delete from a run's folder once the run is over: everything but the `.trace.zip` of a failed test.
 * Playwright records every test's raw trace files into the folder, and Vitest keeps only a failed test's zip.
 */
export function leftovers(names: string[]): string[] {
  return names.filter((name) => !name.endsWith('.trace.zip'))
}

/** The folders under the traces root left by runs whose process has ended, which a new run clears. */
export function finishedRuns(names: string[], isRunning: (pid: number) => boolean): string[] {
  return names.filter((name) => !/^\d+$/.test(name) || !isRunning(Number(name)))
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    /** EPERM: the process exists but belongs to someone else; any other error means it's gone. */
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

/**
 * The browser run's global setup: it clears the traces of finished runs at the start, so what's there is from runs
 * still going or this one, and clears Playwright's raw files at the end, so a passing run leaves nothing behind.
 */
export default function keepFailedTracesOnly(): () => void {
  mkdirSync(TRACES_ROOT, { recursive: true })
  for (const name of finishedRuns(readdirSync(TRACES_ROOT), isRunning))
    rmSync(join(TRACES_ROOT, name), { recursive: true, force: true })
  mkdirSync(TRACES_DIR, { recursive: true })
  return () => {
    const names = readdirSync(TRACES_DIR)
    for (const name of leftovers(names)) rmSync(join(TRACES_DIR, name), { recursive: true, force: true })
    if (leftovers(names).length === names.length) rmdirSync(TRACES_DIR)
  }
}
