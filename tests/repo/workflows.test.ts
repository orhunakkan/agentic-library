import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/**
 * Guards the workflows against the mistakes that would make a public repo unsafe: a self-hosted runner coming back,
 * an unpinned action or image, a trigger that runs fork input with a write token, script injection, a leftover token
 * in `.git/config`, a secret, a write permission nobody approved, or a job with no time limit. It protects against
 * our own mistakes, not against a hostile fork, which can edit this test too: with GitHub-hosted runners and no
 * secrets, a fork has nothing to reach.
 */

const WORKFLOWS = '.github/workflows'
const FIXTURES = 'tests/fixtures/workflows'

/** Events that never run a fork's input with a write token. */
const TRIGGERS = new Set(['push', 'pull_request', 'workflow_dispatch'])
/** Labels a job may run on. Anything else, including an expression, could reach a self-hosted runner. */
const HOSTED_LABELS = new Set(['ubuntu-24.04'])
/**
 * The only write permissions, and the jobs allowed them, as `file:job`: each creates a deployment for the server to
 * validate. Such a job may run only its own shell steps, never a checkout or an action, so no repo code gets its token.
 */
const WRITE_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  'ci.yml:request-dev-deploy': ['deployments'],
  'deploy-prod.yml:deploy-prod': ['deployments'],
}

const PINNED_ACTION = /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/
const PINNED_IMAGE = /@sha256:[0-9a-f]{64}$/
/** Every `${{ … }}` expression, however many `{` and `}` it holds inside. */
const EXPRESSION = /\$\{\{([\s\S]*?)\}\}/g
/** A value a fork or a dispatcher controls, by token: github.event, github['event'], head_ref, inputs, toJSON(github). */
const UNTRUSTED =
  /\bgithub\s*(\.\s*event\b|\[\s*['"]event['"]\s*\]|\.\s*head_ref\b|\[\s*['"]head_ref['"]\s*\])|\binputs\s*[.[]|\btojson\s*\(\s*github\s*\)/i
const SECRETS = /\bsecrets\s*[.[]|\btojson\s*\(\s*secrets\s*\)/i
const CHECKOUT = /^actions\/checkout@/i
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hasUntrusted = (script: string) =>
  [...script.matchAll(EXPRESSION)].some(([, inner]) => UNTRUSTED.test(inner ?? ''))

type Rule =
  | 'trigger'
  | 'runner'
  | 'action-pin'
  | 'image-pin'
  | 'permissions'
  | 'injection'
  | 'checkout-credentials'
  | 'secrets'
  | 'timeout'

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
}

const records = (candidate: unknown): Record<string, unknown>[] =>
  Array.isArray(candidate) ? candidate.filter(isRecord) : []

/** A workflow's trigger names, whether `on` is a string, a list or a map. */
function triggersOf(on: unknown): string[] {
  if (typeof on === 'string') return [on]
  if (Array.isArray(on)) return on.filter((name): name is string => typeof name === 'string')
  return isRecord(on) ? Object.keys(on) : []
}

/** The permissions a `permissions:` value grants write on. `write-all` grants every one. */
function writesOf(permissions: unknown): string[] {
  if (permissions === 'write-all') return ['write-all']
  if (!isRecord(permissions)) return []
  return Object.entries(permissions)
    .filter(([, level]) => level === 'write')
    .map(([scope]) => scope)
}

/** Every image a job pulls: its container and its services, as a string or as `{ image }`. */
function imagesOf(job: Record<string, unknown>): unknown[] {
  const imageOf = (candidate: unknown) => (isRecord(candidate) ? candidate.image : candidate)
  const services = isRecord(job.services) ? Object.values(job.services).map(imageOf) : []
  return [...(job.container === undefined ? [] : [imageOf(job.container)]), ...services]
}

/** Each problem in one workflow file, as `<file>: [<rule>] <what's wrong>`. */
function workflowProblems(file: string, text: string): string[] {
  const problems: string[] = []
  const report = (rule: Rule, message: string) => problems.push(`${file}: [${rule}] ${message}`)

  if (SECRETS.test(text)) report('secrets', 'references secrets, but this repo has none by design')

  /** A `uses:` value, from a step or a job, checked as YAML parsed it, whatever form the line was written in. */
  const checkUses = (where: string, uses: unknown) => {
    if (typeof uses !== 'string') return report('action-pin', `${where} has a uses: that isn't a plain value`)
    if (uses.startsWith('./')) return
    if (uses.startsWith('docker://')) {
      if (!PINNED_IMAGE.test(uses)) report('image-pin', `${where} uses ${uses}, not pinned by @sha256:`)
      return
    }
    const commented = new RegExp(`^\\s*(-\\s+)?uses:\\s*(['"]?)${escapeRegExp(uses)}\\2\\s+#\\s*v\\d`, 'm')
    if (!PINNED_ACTION.test(uses) || !commented.test(text))
      report('action-pin', `${where} uses ${uses}, not pinned to a 40-character commit SHA with a "# v…" comment`)
  }

  const workflow: unknown = parse(text)
  if (!isRecord(workflow) || !isRecord(workflow.jobs)) {
    report('runner', 'has no jobs map')
    return problems
  }
  for (const trigger of triggersOf(workflow.on))
    if (!TRIGGERS.has(trigger)) report('trigger', `is triggered by ${trigger}`)
  if (workflow.permissions === undefined) report('permissions', 'has no top-level permissions:')
  for (const scope of writesOf(workflow.permissions)) report('permissions', `grants ${scope}: write to every job`)

  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (!isRecord(job)) {
      report('runner', `job ${jobName} isn't a map`)
      continue
    }
    const runsOn = job['runs-on']
    if (typeof runsOn !== 'string' || !HOSTED_LABELS.has(runsOn))
      report('runner', `job ${jobName} runs on ${JSON.stringify(runsOn)}, not a GitHub-hosted label`)
    if (typeof job['timeout-minutes'] !== 'number') report('timeout', `job ${jobName} has no timeout-minutes`)
    if (job.uses !== undefined) checkUses(`job ${jobName}`, job.uses)
    const allowed = WRITE_ALLOWLIST[`${file}:${jobName}`] ?? []
    const writes = writesOf(job.permissions)
    for (const scope of writes)
      if (!allowed.includes(scope)) report('permissions', `job ${jobName} asks for ${scope}: write`)
    if (writes.length && records(job.steps).some((step) => step.uses !== undefined))
      report('permissions', `job ${jobName} has a write permission, so it may run only its own shell steps`)
    for (const image of imagesOf(job))
      if (typeof image !== 'string' || !PINNED_IMAGE.test(image))
        report('image-pin', `job ${jobName} uses image ${JSON.stringify(image)}, not pinned by @sha256:`)
    for (const step of records(job.steps)) {
      const script = isRecord(step.with) ? step.with.script : undefined
      if (
        (typeof step.run === 'string' && hasUntrusted(step.run)) ||
        (typeof script === 'string' && hasUntrusted(script))
      )
        report('injection', `job ${jobName} puts an untrusted value straight into a script; pass it through env:`)
      if (step.uses === undefined) continue
      checkUses(`job ${jobName}`, step.uses)
      if (
        typeof step.uses === 'string' &&
        CHECKOUT.test(step.uses) &&
        !(isRecord(step.with) && step.with['persist-credentials'] === false)
      )
        report('checkout-credentials', `job ${jobName} checks out without persist-credentials: false`)
    }
  }
  return problems
}

const yamlFiles = (dir: string) =>
  readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()

describe('the workflows', () => {
  it.each(yamlFiles(WORKFLOWS))('%s follows every rule', (name) => {
    expect(workflowProblems(name, readFileSync(join(WORKFLOWS, name), 'utf8'))).toEqual([])
  })
})

describe('each rule catches its own mistake', () => {
  const RULES: readonly Rule[] = [
    'trigger',
    'runner',
    'action-pin',
    'image-pin',
    'permissions',
    'injection',
    'checkout-credentials',
    'secrets',
    'timeout',
  ]

  it('has one fixture per rule, and no other', () => {
    expect(yamlFiles(FIXTURES)).toEqual(RULES.map((rule) => `${rule}.yml`).sort())
  })

  it.each(RULES)('%s.yml fails with exactly its own rule', (rule) => {
    const name = `${rule}.yml`
    const problems = workflowProblems(name, readFileSync(join(FIXTURES, name), 'utf8'))
    expect(problems.length, problems.join('\n')).toBeGreaterThan(0)
    for (const problem of problems) expect(problem).toContain(`[${rule}]`)
  })
})

describe('forms that a line-by-line check would miss', () => {
  const CHECKOUT_STEP = `      - uses: actions/checkout@${'3'.repeat(40)} # v7.0.1\n        with:\n          persist-credentials: false\n`
  /** A workflow that follows every rule, with `steps` as its only job's steps and `extra` added to the job. */
  const workflow = (steps: string, extra = '', name = 'probe.yml') =>
    workflowProblems(
      name,
      `name: Probe\non: push\npermissions:\n  contents: read\njobs:\n  build:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n${extra}    steps:\n${steps}`,
    )
  const rulesOf = (problems: string[]) => [...new Set(problems.map((problem) => /\[([a-z-]+)\]/.exec(problem)?.[1]))]

  it('passes the plain workflow these probes start from', () => {
    expect(workflow(`${CHECKOUT_STEP}      - run: echo ok\n`)).toEqual([])
  })

  it('checks the pin of a step written in flow style, with a quoted key, or with its value on the next line', () => {
    expect(rulesOf(workflow(`${CHECKOUT_STEP}      - {uses: evil/action@main}\n`))).toEqual(['action-pin'])
    expect(rulesOf(workflow(`${CHECKOUT_STEP}      - {uses: "docker://alpine:latest"}\n`))).toEqual(['image-pin'])
    expect(rulesOf(workflow(`${CHECKOUT_STEP}      - "uses": evil/action@main\n`))).toEqual(['action-pin'])
    expect(rulesOf(workflow(`${CHECKOUT_STEP}      - uses:\n          evil/action@main\n`))).toEqual(['action-pin'])
    expect(rulesOf(workflow(`${CHECKOUT_STEP}      - {uses: actions/setup-node@${'4'.repeat(40)}}\n`))).toEqual([
      'action-pin',
    ])
  })

  it('checks a job-level reusable workflow', () => {
    const problems = workflowProblems(
      'probe.yml',
      'name: Probe\non: push\npermissions:\n  contents: read\njobs:\n  shared:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    uses: evil/repo/.github/workflows/x.yml@main\n',
    )
    expect(rulesOf(problems)).toEqual(['action-pin'])
  })

  it('finds untrusted values by token, inside any expression, in run: and in a script input', () => {
    for (const expression of [
      "format('{0}', github.event.pull_request.title)",
      "github['event'].pull_request.title",
      'toJSON(github)',
      'github.head_ref',
      "inputs['sha']",
    ])
      expect(rulesOf(workflow(`${CHECKOUT_STEP}      - run: echo "\${{ ${expression} }}"\n`)), expression).toEqual([
        'injection',
      ])
    const script = `      - uses: actions/github-script@${'5'.repeat(40)} # v8.0.0\n        with:\n          script: console.log('\${{ github.event.issue.title }}')\n`
    expect(rulesOf(workflow(`${CHECKOUT_STEP}${script}`))).toEqual(['injection'])
    expect(workflow(`${CHECKOUT_STEP}      - run: echo "\${{ github.sha }} \${{ runner.temp }}"\n`)).toEqual([])
  })

  it('checks a checkout whatever its case, and finds secrets by index or by toJSON', () => {
    const shouting = `      - uses: Actions/Checkout@${'3'.repeat(40)} # v7.0.1\n`
    expect(rulesOf(workflow(shouting))).toEqual(['checkout-credentials'])
    expect(
      rulesOf(workflow(`${CHECKOUT_STEP}      - run: echo ok\n        env:\n          ALL: \${{ toJSON(secrets) }}\n`)),
    ).toEqual(['secrets'])
    expect(
      rulesOf(workflow(`${CHECKOUT_STEP}      - run: echo ok\n        env:\n          T: \${{ secrets['X'] }}\n`)),
    ).toEqual(['secrets'])
  })

  it('allows a write only to its file:job, and only for a job that runs no action or checkout', () => {
    const writes = '    permissions:\n      deployments: write\n'
    const deployJob = (name: string, steps: string) =>
      workflowProblems(
        name,
        `name: Probe\non: push\npermissions:\n  contents: read\njobs:\n  request-dev-deploy:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n${writes}    steps:\n${steps}`,
      )
    expect(deployJob('ci.yml', '      - run: echo deploy\n')).toEqual([])
    expect(rulesOf(deployJob('other.yml', '      - run: echo deploy\n'))).toEqual(['permissions'])
    expect(rulesOf(deployJob('ci.yml', `${CHECKOUT_STEP}      - run: pnpm install\n`))).toEqual(['permissions'])
  })
})
