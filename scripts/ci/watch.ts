import { execFileSync, spawn } from 'node:child_process'

/**
 * Watches the CI run for one commit and gives its real verdict: `pnpm ci:watch [ref]` (default HEAD).
 * It resolves the full SHA itself, waits up to five minutes for the `ci.yml` run of that commit to
 * appear, watches it to the end, prints `<job name>: <conclusion>` for each job and then
 * `CI <success|failure> for <short sha>: <run url>` as the last line, and exits 0 only on success.
 * Don't pipe it: its exit code is the verdict.
 */

const APPEAR_TIMEOUT_MS = 5 * 60_000
const POLL_MS = 15_000

export interface Tools {
  git(args: string[]): string
  gh(args: string[]): Promise<string>
  sleep(ms: number): Promise<void>
  now(): number
  say(line: string): void
}

export interface Job {
  name: string
  conclusion: string
}

export interface Verdict {
  ok: boolean
  lines: string[]
}

/**
 * Jobs that `.github/workflows/ci.yml` skips by design: "Deploy to dev" runs only for a push to main,
 * so a pull request or a manual run on another branch skips it. On a push to main it is skipped only
 * when the e2e job didn't succeed, and that job already fails the verdict. Every other job ("Lint,
 * types, unit tests, audit", "Build and end-to-end tests") must succeed: skipped counts as a failure.
 */
const MAY_SKIP = new Set(['Deploy to dev'])

function passed(job: Job): boolean {
  return job.conclusion === 'success' || (job.conclusion === 'skipped' && MAY_SKIP.has(job.name))
}

export function verdict(jobs: Job[], run: { url: string; shortSha: string }): Verdict {
  const ok = jobs.length > 0 && jobs.every(passed)
  const lines = jobs.map((job) => `${job.name}: ${job.conclusion}`)
  lines.push(`CI ${ok ? 'success' : 'failure'} for ${run.shortSha}: ${run.url}`)
  return { ok, lines }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type Lookup = { run: { id: string; url: string } } | { run: null; lastError: string | null }

/** Polls until the run appears or the timeout passes. A failing `gh run list` is retried, like a missing run. */
async function findRun(sha: string, shortSha: string, tools: Tools): Promise<Lookup> {
  const start = tools.now()
  let lastError: string | null = null
  for (let first = true; ; first = false) {
    try {
      const args = ['run', 'list', '--workflow', 'ci.yml', '--commit', sha, '--limit', '1', '--json', 'databaseId,url']
      const [run] = JSON.parse(await tools.gh(args)) as { databaseId: number; url: string }[]
      if (run) return { run: { id: String(run.databaseId), url: run.url } }
    } catch (error) {
      lastError = message(error)
    }
    if (tools.now() - start >= APPEAR_TIMEOUT_MS) return { run: null, lastError }
    if (first) tools.say(`Waiting for the ci.yml run for ${shortSha} to appear`)
    await tools.sleep(POLL_MS)
  }
}

export async function watchCi(ref: string, tools: Tools): Promise<Verdict> {
  const sha = tools.git(['rev-parse', '--verify', `${ref}^{commit}`])
  const shortSha = tools.git(['rev-parse', '--short', sha])
  const lookup = await findRun(sha, shortSha, tools)
  if (!lookup.run) {
    const minutes = APPEAR_TIMEOUT_MS / 60_000
    const lines = [`No ci.yml run appeared for ${shortSha} within ${minutes} minutes; was it pushed?`]
    if (lookup.lastError) lines.push(`Last gh error: ${lookup.lastError}`)
    lines.push(`CI failure for ${shortSha}: no run`)
    return { ok: false, lines }
  }
  const { run } = lookup
  tools.say(`Watching ${run.url}`)
  /** Its exit status isn't the verdict, each job's conclusion is; its error explains a run left unfinished. */
  const watchError = await tools.gh(['run', 'watch', run.id, '--exit-status']).then(
    () => null,
    (error: unknown) => message(error),
  )
  const view = JSON.parse(await tools.gh(['run', 'view', run.id, '--json', 'status,url,jobs'])) as {
    status: string
    url: string
    jobs: Job[]
  }
  const result = verdict(view.jobs, { url: view.url, shortSha })
  if (view.status === 'completed') return result
  const why = watchError ?? 'gh run watch stopped early'
  const lines = result.lines.slice(0, -1)
  return {
    ok: false,
    lines: [`The run is still ${view.status}: ${why}`, ...lines, `CI failure for ${shortSha}: ${view.url}`],
  }
}

function gh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`gh ${args.join(' ')} exited ${code}: ${stderr.trim()}`)),
    )
  })
}

async function main(): Promise<void> {
  const tools: Tools = {
    git: (args) => execFileSync('git', args, { encoding: 'utf8' }).trim(),
    gh,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    say: (line) => console.log(line),
  }
  const { ok, lines } = await watchCi(process.argv[2] ?? 'HEAD', tools)
  for (const line of lines) console.log(line)
  process.exitCode = ok ? 0 : 1
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`ci:watch: ${message(error)}`)
    process.exitCode = 1
  })
}
