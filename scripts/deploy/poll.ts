import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  type Action,
  ciStateOf,
  decide,
  type Environment,
  isFullSha,
  newestOf,
  REFUSALS,
  type RelationToMain,
  readDeployRecord,
  recordFacts,
  type ShaFacts,
  type WaitingRequest,
} from './decide.ts'

/**
 * The server's deploy poller, run every 30 seconds by folio-deploy-poll.timer. It reads the GitHub Deployments that
 * CI and deploy-prod.yml request, checks each commit for itself through decide.ts, and runs the deploy script for the
 * ones that pass. Nothing in GitHub can reach the server or hold a credential for it.
 *
 * What it trusts from GitHub is only what GitHub itself computes: a commit's relation to main and CI's runs. What has
 * been deployed comes from the server's own record in $STATE_DIRECTORY, never from deployment statuses, which anyone
 * with `deployments: write` can post.
 *
 * The token comes from the systemd credential `github_token` (LoadCredential=), never from an argument or a
 * variable, and is never printed. Statuses carry fixed texts only. Full output goes to the journal.
 *
 *   node poll.ts [--dry-run] [--repo owner/name]
 */

const USAGE = 'usage: node poll.ts [--dry-run] [--repo owner/name]'
const DEFAULT_REPO = 'orhunakkan/agentic-library'
const API = 'https://api.github.com'
const DEPLOY_SCRIPT = '/usr/local/bin/agentic-library-deploy'
const ENVIRONMENTS: readonly Environment[] = ['dev', 'production']
/** The deploy script's own name for each environment. */
const SCRIPT_ENVIRONMENT: Readonly<Record<Environment, string>> = { dev: 'dev', production: 'prod' }
/** Statuses that leave a request waiting. Any other is final, or `in_progress`, which a pass that stopped leaves. */
const WAITING_STATES = new Set(['pending', 'queued'])
/** Requests looked at per pass, newest first. Waiting ones are always the newest, so a page is plenty. */
const RECENT_REQUESTS = 10
const LOCK_HELD = 'FOLIO_DEPLOY_POLL_LOCKED'

class UsageError extends Error {}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
}

function readToken(): string {
  const directory = process.env.CREDENTIALS_DIRECTORY
  const file = directory ? join(directory, 'github_token') : null
  const token = file && existsSync(file) ? readFileSync(file, 'utf8').trim() : ''
  if (!token)
    throw new Error(
      'no GitHub token: run this from folio-deploy-poll.service, whose LoadCredential=github_token supplies it. ' +
        'Nothing was changed.',
    )
  return token
}

/** Where the server records each deploy the deploy script finished: systemd's StateDirectory=. */
function recordFile(): string | null {
  const directory = process.env.STATE_DIRECTORY
  return directory ? join(directory, 'deployed.jsonl') : null
}

function readRecord(): ReturnType<typeof readDeployRecord> {
  const file = recordFile()
  return file && existsSync(file) ? readDeployRecord(readFileSync(file, 'utf8')) : []
}

/** One GitHub REST call. The answer is `unknown` until the caller narrows it. */
function github(token: string) {
  return async (method: 'GET' | 'POST', path: string, body?: object): Promise<unknown> => {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'folio-deploy-poll',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub answered ${response.status} to ${method} ${path.split('?')[0]}`)
    return response.json()
  }
}

type Call = ReturnType<typeof github>

const records = (candidate: unknown): Record<string, unknown>[] =>
  Array.isArray(candidate) ? candidate.filter(isRecord) : []

/**
 * The environment's waiting requests: among its newest ones, those whose latest status is still waiting, read newest
 * first, stopping at the first that isn't, since everything older has been dealt with.
 */
async function waitingRequests(call: Call, repo: string, environment: Environment): Promise<WaitingRequest[]> {
  const query = new URLSearchParams({ environment, per_page: String(RECENT_REQUESTS) })
  const waiting: WaitingRequest[] = []
  for (const deployment of records(await call('GET', `/repos/${repo}/deployments?${query}`))) {
    if (typeof deployment.id !== 'number' || typeof deployment.sha !== 'string') continue
    const [latest] = records(await call('GET', `/repos/${repo}/deployments/${deployment.id}/statuses?per_page=1`))
    const state = latest ? latest.state : null
    if (state !== null && !(typeof state === 'string' && WAITING_STATES.has(state))) break
    waiting.push({ id: deployment.id, sha: deployment.sha })
  }
  return waiting
}

async function factsAbout(call: Call, repo: string, environment: Environment, sha: string): Promise<ShaFacts> {
  const compare = await call('GET', `/repos/${repo}/compare/main...${sha}`)
  const status = isRecord(compare) ? compare.status : null
  const relationToMain: RelationToMain =
    status === 'identical' || status === 'behind' || status === 'ahead' || status === 'diverged' ? status : null
  const query = new URLSearchParams({ head_sha: sha, event: 'push', branch: 'main', per_page: '20' })
  const runs = await call('GET', `/repos/${repo}/actions/workflows/ci.yml/runs?${query}`)
  const ci = ciStateOf(
    records(isRecord(runs) ? runs.workflow_runs : null).map(({ status, conclusion }) => ({ status, conclusion })),
  )
  return { sha, relationToMain, ci, ...recordFacts(readRecord(), environment, sha) }
}

function describe(environment: Environment, action: Action): string {
  switch (action.kind) {
    case 'deploy':
      return `${environment}: deploy ${action.sha} (request ${action.id})`
    case 'refuse':
      return `${environment}: refuse request ${action.id}, ${REFUSALS[action.reason]}`
    case 'supersede':
      return `${environment}: mark request ${action.id} inactive, superseded by a newer one`
    case 'already_deployed':
      return `${environment}: request ${action.id} is the commit already live`
    case 'wait':
      return `${environment}: request ${action.id} waits, as CI is still running for it`
  }
}

async function setStatus(call: Call, repo: string, id: number, state: string, description: string, tries = 1) {
  for (let attempt = 1; ; attempt++) {
    try {
      await call('POST', `/repos/${repo}/deployments/${id}/statuses`, { state, description, auto_inactive: false })
      return
    } catch (error) {
      if (attempt >= tries) throw error
      await new Promise((resolve) => setTimeout(resolve, 5000 * attempt))
    }
  }
}

async function act(call: Call, repo: string, environment: Environment, action: Action): Promise<void> {
  if (action.kind === 'wait') return
  if (action.kind === 'supersede') return setStatus(call, repo, action.id, 'inactive', 'Superseded by a newer request')
  if (action.kind === 'refuse') return setStatus(call, repo, action.id, 'failure', REFUSALS[action.reason])
  if (action.kind === 'already_deployed') return setStatus(call, repo, action.id, 'success', 'Already deployed')
  const file = recordFile()
  if (!file) throw new Error('no STATE_DIRECTORY to record deploys in: run this from folio-deploy-poll.service')
  await setStatus(call, repo, action.id, 'in_progress', 'Deploying')
  const deploy = spawnSync('sudo', ['-n', DEPLOY_SCRIPT, SCRIPT_ENVIRONMENT[environment], action.sha], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  const deployed = deploy.status === 0
  console.log(`${environment}: the deploy script ${deployed ? 'succeeded' : `failed (exit ${deploy.status})`}`)
  if (deployed) appendFileSync(file, `${JSON.stringify({ environment, sha: action.sha, deployment: action.id })}\n`)
  await setStatus(
    call,
    repo,
    action.id,
    deployed ? 'success' : 'failure',
    deployed ? 'Deployed' : 'The deploy failed',
    4,
  )
}

async function pollEnvironment(call: Call, repo: string, environment: Environment, dryRun: boolean) {
  const waiting = await waitingRequests(call, repo, environment)
  const newest = newestOf(waiting)
  const facts = newest && isFullSha(newest.sha) ? await factsAbout(call, repo, environment, newest.sha) : null
  const actions = decide(environment, waiting, facts)
  if (!actions.length) console.log(`${environment}: nothing waiting`)
  for (const action of actions) {
    console.log(`${dryRun ? 'would ' : ''}${describe(environment, action)}`)
    if (!dryRun) await act(call, repo, environment, action)
  }
}

async function run(argv: string[]): Promise<boolean> {
  let options: { 'dry-run'?: boolean; repo?: string }
  try {
    options = parseArgs({
      args: argv,
      options: { 'dry-run': { type: 'boolean' }, repo: { type: 'string' } },
      allowPositionals: false,
    }).values
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
  const repo = options.repo ?? DEFAULT_REPO
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new UsageError('--repo must be owner/name')
  const call = github(readToken())
  let allPolled = true
  /** Each environment on its own, so a failure in dev's pass never stops production's. */
  for (const environment of ENVIRONMENTS)
    try {
      await pollEnvironment(call, repo, environment, options['dry-run'] === true)
    } catch (error) {
      allPolled = false
      console.error(`poll: ${environment}: ${error instanceof Error ? error.message : String(error)}`)
    }
  return allPolled
}

/** One run at a time: the poller re-runs itself under `flock -n`, and a run that finds the lock taken just stops. */
function underLock(): boolean {
  if (process.env[LOCK_HELD] === '1') return true
  const lock = join(process.env.RUNTIME_DIRECTORY ?? tmpdir(), 'folio-deploy-poll.lock')
  const locked = spawnSync('flock', ['-n', '-E', '75', lock, process.execPath, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, [LOCK_HELD]: '1' },
  })
  if (locked.status === 75) console.log('another poll is running; this one stops')
  process.exitCode = locked.status === 75 ? 0 : (locked.status ?? 1)
  return false
}

if (underLock()) {
  try {
    process.exitCode = (await run(process.argv.slice(2))) ? 0 : 1
  } catch (error) {
    console.error(`poll: ${error instanceof Error ? error.message : String(error)}`)
    if (error instanceof UsageError) console.error(USAGE)
    process.exitCode = 1
  }
}
