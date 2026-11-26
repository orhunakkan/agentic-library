import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DESIRED, type JsonValue } from './desired.ts'
import { type ApiAnswer, checkSettings, fixFor, holds, report, type Verdict } from './settings.ts'

/** Recorded `gh api` answers for a made-up repo, so the comparison runs with no network. */
const TARGET = { repo: 'example/folio', owner: 'example' }

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
}

function answersFrom(file: string): Map<string, ApiAnswer> {
  const recorded: unknown = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'))
  if (!isRecord(recorded)) throw new Error(`${file} isn't a map of answers`)
  const answers = new Map<string, ApiAnswer>()
  for (const [path, answer] of Object.entries(recorded)) {
    if (!isRecord(answer) || typeof answer.status !== 'number') throw new Error(`${file}: ${path} has no status`)
    answers.set(path, { status: answer.status, body: answer.body })
  }
  return answers
}

function rulesetFile(name: string): JsonValue {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL(`../../.github/rulesets/${name}.json`, import.meta.url), 'utf8'),
  )
  if (!isRecord(parsed)) throw new Error(`${name}.json isn't an object`)
  return parsed as JsonValue
}

const RULESETS = { 'main-history': rulesetFile('main-history'), 'main-changes': rulesetFile('main-changes') }
const stateOf = (verdicts: Verdict[], id: string) => verdicts.find((verdict) => verdict.setting.id === id)?.state

describe('holds', () => {
  it('lets objects have more fields, but matches lists item for item, in any order', () => {
    expect(holds({ a: 1, b: 2 }, { a: 1 })).toBe(true)
    expect(holds({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(holds([{ x: 1, y: 0 }, { x: 2 }], [{ x: 2 }, { x: 1 }])).toBe(true)
    expect(holds([{ x: 1 }, { x: 1 }], [{ x: 1 }])).toBe(false)
    expect(holds([{ x: 1 }], [{ x: 1 }, { x: 1 }])).toBe(false)
    expect(holds('all', 'selected')).toBe(false)
    expect(holds(null, { a: 1 })).toBe(false)
  })
})

describe('checkSettings', () => {
  it('finds a public repo set up as desired to match on every row', () => {
    const verdicts = checkSettings(DESIRED, answersFrom('public-matching.json'), RULESETS, TARGET)
    expect(verdicts.filter((verdict) => verdict.state !== 'matches').map((verdict) => verdict.setting.id)).toEqual([])
    expect(report(verdicts)).toEqual({ lines: expect.arrayContaining(['no differences']), differences: 0 })
  })

  it('reports today’s private repo row by row, and counts the rows only a public repo can have', () => {
    const verdicts = checkSettings(DESIRED, answersFrom('private-today.json'), RULESETS, TARGET)
    expect(
      Object.fromEntries(verdicts.filter((v) => v.state !== 'matches').map((v) => [v.setting.id, v.state])),
    ).toEqual({
      'ruleset-main-history': 'unreadable',
      'ruleset-main-changes': 'unreadable',
      'secret-scanning': 'differs',
      'private-vulnerability-reporting': 'missing',
      'dependabot-alerts': 'differs',
      'dependabot-security-updates': 'differs',
      'actions-permissions': 'differs',
      'self-hosted-runners': 'differs',
      variables: 'differs',
      'wiki-projects': 'differs',
    })
    const { lines, differences } = report(verdicts)
    expect(differences).toBe(10)
    expect(lines.at(-1)).toBe('10 difference(s), 4 of them in rows only a public repo can have')
    expect(lines).toContain('differs    Actions off: enabled: true')
  })

  it('reports a ruleset that’s missing, or that differs from its file, and offers the fix', () => {
    const answers = answersFrom('public-matching.json')
    answers.set('/repos/example/folio/rulesets', { status: 200, body: [{ id: 12, name: 'main-changes' }] })
    const changed = answers.get('/repos/example/folio/rulesets/12')
    if (!changed || !isRecord(changed.body)) throw new Error('no main-changes detail')
    answers.set('/repos/example/folio/rulesets/12', { status: 200, body: { ...changed.body, bypass_actors: [] } })

    const verdicts = checkSettings(DESIRED, answers, RULESETS, TARGET)
    const history = verdicts.find((verdict) => verdict.setting.id === 'ruleset-main-history')
    const changes = verdicts.find((verdict) => verdict.setting.id === 'ruleset-main-changes')
    expect(history).toMatchObject({ state: 'missing' })
    expect(changes).toMatchObject({ state: 'differs', found: 'differs in bypass_actors', rulesetId: 12 })
    if (!history || !changes) throw new Error('no ruleset verdicts')
    expect(fixFor(history, RULESETS)).toEqual([
      { method: 'POST', path: '/repos/{repo}/rulesets', body: RULESETS['main-history'] },
    ])
    expect(fixFor(changes, RULESETS)).toEqual([
      { method: 'PUT', path: '/repos/{repo}/rulesets/12', body: RULESETS['main-changes'] },
    ])
  })

  it('reports paused updates, a writable deploy key, another collaborator and an invitation', () => {
    const answers = answersFrom('public-matching.json')
    answers.set('/repos/example/folio/automated-security-fixes', { status: 200, body: { enabled: true, paused: true } })
    answers.set('/repos/example/folio/invitations?per_page=100', { status: 200, body: [{ id: 7 }] })
    answers.set('/repos/example/folio/keys?per_page=100', {
      status: 200,
      body: [
        { id: 1, read_only: true },
        { id: 2, read_only: false },
      ],
    })
    answers.set('/repos/example/folio/collaborators?affiliation=all&per_page=100', {
      status: 200,
      body: [{ login: 'example' }, { login: 'someone' }],
    })
    const verdicts = checkSettings(DESIRED, answers, RULESETS, TARGET)
    expect(stateOf(verdicts, 'dependabot-security-updates')).toBe('differs')
    expect(stateOf(verdicts, 'invitations')).toBe('differs')
    expect(verdicts.find((v) => v.setting.id === 'deploy-keys')?.found).toBe('1 of 2 don\'t have {"read_only":true}')
    expect(stateOf(verdicts, 'collaborators')).toBe('differs')
    const collaborators = verdicts.find((verdict) => verdict.setting.id === 'collaborators')
    if (!collaborators) throw new Error('no collaborators verdict')
    expect(fixFor(collaborators, RULESETS)).toMatch(/^remove every other collaborator/)
  })

  it('calls an answer of an unexpected shape unreadable, instead of guessing', () => {
    const answers = answersFrom('public-matching.json')
    answers.set('/repos/example/folio/actions/permissions', { status: 200, body: ['not', 'an', 'object'] })
    answers.set('/repos/example/folio/keys?per_page=100', { status: 200, body: { not: 'a list' } })
    answers.set('/repos/example/folio/rulesets', { status: 200, body: 'not a list' })
    answers.delete('/repos/example/folio/actions/secrets')
    const verdicts = checkSettings(DESIRED, answers, RULESETS, TARGET)
    for (const id of ['actions-permissions', 'deploy-keys', 'ruleset-main-history', 'secrets'])
      expect(stateOf(verdicts, id), id).toBe('unreadable')
  })
})

describe('the desired state', () => {
  it('has one row per setting, with each public-only row marked', () => {
    expect(DESIRED.map((setting) => setting.id)).toEqual([
      'ruleset-main-history',
      'ruleset-main-changes',
      'secret-scanning',
      'private-vulnerability-reporting',
      'dependabot-alerts',
      'dependabot-security-updates',
      'actions-permissions',
      'self-hosted-runners',
      'variables',
      'secrets',
      'dependabot-secrets',
      'codespaces-secrets',
      'collaborators',
      'invitations',
      'deploy-keys',
      'wiki-projects',
    ])
    expect(DESIRED.filter((setting) => setting.needsPublic).map((setting) => setting.id)).toEqual([
      'ruleset-main-history',
      'ruleset-main-changes',
      'secret-scanning',
      'private-vulnerability-reporting',
    ])
  })

  it('requires a squash PR on main-changes, with no status checks and only the admin bypass', () => {
    const changes = JSON.stringify(RULESETS['main-changes'])
    expect(changes).toContain('"allowed_merge_methods":["squash"]')
    expect(changes).not.toContain('required_status_checks')
    expect(changes).toContain('"bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}]')
    expect(JSON.stringify(RULESETS['main-history'])).toContain('"bypass_actors":[]')
  })
})
