/**
 * What the deploy poller does with the deployment requests waiting for one environment. A pure function, so every
 * refusal is unit tested: the server is the security boundary, not the workflow that made the request. Before it
 * deploys commit S, it checks for itself that S is a full SHA, is main or an ancestor of main, passed CI on a push to
 * main, and, for production, was deployed to dev successfully.
 */

export type Environment = 'dev' | 'production'

/** A deployment request with no final status yet. GitHub numbers them in the order they were made. */
export interface WaitingRequest {
  id: number
  sha: string
}

/** What GitHub's compare API says of `main...sha`; null when the commit isn't in the repository. */
export type RelationToMain = 'identical' | 'behind' | 'ahead' | 'diverged' | null

/** What the poller found out about the newest request's commit. */
export interface ShaFacts {
  sha: string
  relationToMain: RelationToMain
  /**
   * The `ci.yml` runs triggered by a push to main with this head: `passed` when one concluded `success`, `pending`
   * when none has yet but one is still running (the dev request comes from inside that run), else `failed`.
   */
  ci: CiState
  /** This server deployed the commit to dev, by its own record, which no status on GitHub can fake. */
  devSucceeded: boolean
  /** The commit this server last deployed to the environment, by its own record. */
  liveSha: string | null
}

export type CiState = 'passed' | 'pending' | 'failed'

export type RefusalReason = 'bad_sha' | 'not_on_main' | 'ci_not_green' | 'not_tested_on_dev'

/** The only texts a refused deployment's status carries: fixed, short, and never a log, a path or a value. */
export const REFUSALS: Readonly<Record<RefusalReason, string>> = {
  bad_sha: 'Refused: not a full 40-character commit SHA',
  not_on_main: 'Refused: the commit is not on main',
  ci_not_green: 'Refused: CI has not passed for this commit on main',
  not_tested_on_dev: 'Refused: dev has not deployed this commit successfully',
}

export type Action =
  | { kind: 'deploy'; id: number; sha: string }
  | { kind: 'refuse'; id: number; reason: RefusalReason }
  | { kind: 'supersede'; id: number }
  | { kind: 'already_deployed'; id: number }
  /** CI is still running for the commit: leave the request waiting, and look again on the next pass. */
  | { kind: 'wait'; id: number }

const FULL_SHA = /^[0-9a-f]{40}$/

export const isFullSha = (sha: string) => FULL_SHA.test(sha)

/** The request to act on: the newest one. Older ones are superseded, whichever commit they name. */
export function newestOf(waiting: readonly WaitingRequest[]): WaitingRequest | null {
  return waiting.reduce<WaitingRequest | null>((newest, next) => (!newest || next.id > newest.id ? next : newest), null)
}

function verdict(environment: Environment, newest: WaitingRequest, facts: ShaFacts | null): Action {
  if (!isFullSha(newest.sha)) return { kind: 'refuse', id: newest.id, reason: 'bad_sha' }
  if (!facts || facts.sha !== newest.sha) throw new Error(`no facts about ${newest.sha} to judge request ${newest.id}`)
  if (facts.relationToMain !== 'identical' && facts.relationToMain !== 'behind')
    return { kind: 'refuse', id: newest.id, reason: 'not_on_main' }
  if (facts.ci === 'pending') return { kind: 'wait', id: newest.id }
  if (facts.ci === 'failed') return { kind: 'refuse', id: newest.id, reason: 'ci_not_green' }
  if (environment === 'production' && !facts.devSucceeded)
    return { kind: 'refuse', id: newest.id, reason: 'not_tested_on_dev' }
  if (facts.liveSha === newest.sha) return { kind: 'already_deployed', id: newest.id }
  return { kind: 'deploy', id: newest.id, sha: newest.sha }
}

/**
 * The actions for one environment's waiting requests, older ones first. `facts` are about the newest request's
 * commit, and may be null when its SHA isn't a full SHA, which is refused before anything is asked of GitHub.
 */
export function decide(environment: Environment, waiting: readonly WaitingRequest[], facts: ShaFacts | null): Action[] {
  const newest = newestOf(waiting)
  if (!newest) return []
  const superseded = waiting
    .filter((request) => request.id !== newest.id)
    .sort((a, b) => a.id - b.id)
    .map((request): Action => ({ kind: 'supersede', id: request.id }))
  return [...superseded, verdict(environment, newest, facts)]
}

/** The CI state from the `ci.yml` push runs on main for one head, each with its `status` and `conclusion`. */
export function ciStateOf(runs: readonly { status: unknown; conclusion: unknown }[]): CiState {
  if (runs.some((run) => run.conclusion === 'success')) return 'passed'
  return runs.some((run) => run.status !== 'completed') ? 'pending' : 'failed'
}

/** One line of the server's own record: a deploy that the deploy script finished successfully. */
export interface DeployRecord {
  environment: Environment
  sha: string
}

/**
 * The server's deploy record, one JSON object per line, oldest first. A line that isn't a well-formed record is
 * skipped, so a torn last line from a crash can't make a commit look deployed.
 */
export function readDeployRecord(text: string): DeployRecord[] {
  return text.split('\n').flatMap((line): DeployRecord[] => {
    try {
      const entry: unknown = JSON.parse(line)
      if (typeof entry !== 'object' || entry === null || !('environment' in entry) || !('sha' in entry)) return []
      const { environment, sha } = entry
      return (environment === 'dev' || environment === 'production') && typeof sha === 'string' && isFullSha(sha)
        ? [{ environment, sha }]
        : []
    } catch {
      return []
    }
  })
}

/** What the record says of one commit: whether dev has run it, and what each environment runs now. */
export function recordFacts(record: readonly DeployRecord[], environment: Environment, sha: string) {
  return {
    devSucceeded: record.some((entry) => entry.environment === 'dev' && entry.sha === sha),
    liveSha: record.filter((entry) => entry.environment === environment).at(-1)?.sha ?? null,
  }
}
