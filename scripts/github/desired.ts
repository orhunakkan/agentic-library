/**
 * The GitHub settings this repository should have, one entry per setting.
 * `settings.ts --check` compares them with the live repository, and `--apply` sets the ones it can. Rows marked
 * `needsPublic` can only be set once the repository is public, and go-public applies them. Paths use `{repo}` for
 * owner/name and `{owner}` for the owner.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** What a read must answer for the setting to match. */
export type Expectation =
  /** The body is an object holding at least these fields, with these values. Lists must match item for item. */
  | { kind: 'fields'; fields: Record<string, JsonValue> }
  /** The answer has this HTTP status, as an endpoint that answers 204 when a feature is on and 404 when it's off. */
  | { kind: 'status'; status: number }
  /** The body, or its `list` field, is a list whose every item holds these fields. An empty list matches. */
  | { kind: 'each'; list?: string; fields: Record<string, JsonValue> }
  /** The body, or its `list` field, is a list whose items' `field` values are exactly these. */
  | { kind: 'only'; list?: string; field: string; values: string[] }
  /** The ruleset with this name matches `.github/rulesets/<name>.json`. `read` lists the rulesets. */
  | { kind: 'ruleset'; name: string }

export interface ApiCall {
  method: 'PUT' | 'PATCH' | 'POST'
  path: string
  body?: Record<string, JsonValue>
}

export interface DesiredSetting {
  id: string
  label: string
  /** Applied by go-public, because GitHub only offers it on a public repository (or a paid plan). */
  needsPublic: boolean
  read: string
  expect: Expectation
  /** The calls that set it, or what the owner does by hand when no call should (deleting, deregistering). */
  apply: readonly ApiCall[] | { byHand: string }
}

const SECURITY_AND_ANALYSIS = {
  security_and_analysis: {
    secret_scanning: { status: 'enabled' },
    secret_scanning_push_protection: { status: 'enabled' },
  },
}
/** There's no CI: the checks run locally, in the pre-commit hook and by hand, so Actions stays off. */
const ACTIONS_PERMISSIONS = { enabled: false }
const FEATURES_OFF = { has_wiki: false, has_projects: false }

export const DESIRED: readonly DesiredSetting[] = [
  {
    id: 'ruleset-main-history',
    label: 'Ruleset main-history: no deletion or force push on main, no bypass',
    needsPublic: true,
    read: '/repos/{repo}/rulesets',
    expect: { kind: 'ruleset', name: 'main-history' },
    apply: [],
  },
  {
    id: 'ruleset-main-changes',
    label: 'Ruleset main-changes: a squash PR, admin bypass',
    needsPublic: true,
    read: '/repos/{repo}/rulesets',
    expect: { kind: 'ruleset', name: 'main-changes' },
    apply: [],
  },
  {
    id: 'secret-scanning',
    label: 'Secret scanning and push protection on',
    needsPublic: true,
    read: '/repos/{repo}',
    expect: { kind: 'fields', fields: SECURITY_AND_ANALYSIS },
    apply: [{ method: 'PATCH', path: '/repos/{repo}', body: SECURITY_AND_ANALYSIS }],
  },
  {
    id: 'private-vulnerability-reporting',
    label: 'Private vulnerability reporting on',
    needsPublic: true,
    read: '/repos/{repo}/private-vulnerability-reporting',
    expect: { kind: 'fields', fields: { enabled: true } },
    apply: [{ method: 'PUT', path: '/repos/{repo}/private-vulnerability-reporting' }],
  },
  {
    id: 'dependabot-alerts',
    label: 'Dependabot alerts on',
    needsPublic: false,
    read: '/repos/{repo}/vulnerability-alerts',
    expect: { kind: 'status', status: 204 },
    apply: [{ method: 'PUT', path: '/repos/{repo}/vulnerability-alerts' }],
  },
  {
    id: 'dependabot-security-updates',
    label: 'Dependabot security updates on',
    needsPublic: false,
    read: '/repos/{repo}/automated-security-fixes',
    expect: { kind: 'fields', fields: { enabled: true, paused: false } },
    apply: [{ method: 'PUT', path: '/repos/{repo}/automated-security-fixes' }],
  },
  {
    id: 'actions-permissions',
    label: 'Actions off',
    needsPublic: false,
    read: '/repos/{repo}/actions/permissions',
    expect: { kind: 'fields', fields: ACTIONS_PERMISSIONS },
    apply: [{ method: 'PUT', path: '/repos/{repo}/actions/permissions', body: ACTIONS_PERMISSIONS }],
  },
  {
    id: 'self-hosted-runners',
    label: 'No self-hosted runners registered',
    needsPublic: false,
    read: '/repos/{repo}/actions/runners',
    expect: { kind: 'fields', fields: { total_count: 0 } },
    apply: { byHand: 'deregister each runner (Settings, Actions, Runners) and remove its service from the server' },
  },
  {
    id: 'variables',
    label: 'No Actions variables',
    needsPublic: false,
    read: '/repos/{repo}/actions/variables',
    expect: { kind: 'fields', fields: { total_count: 0 } },
    apply: { byHand: 'delete each variable (Settings, Secrets and variables, Actions)' },
  },
  {
    id: 'secrets',
    label: 'No Actions secrets',
    needsPublic: false,
    read: '/repos/{repo}/actions/secrets',
    expect: { kind: 'fields', fields: { total_count: 0 } },
    apply: { byHand: 'delete each secret (Settings, Secrets and variables, Actions)' },
  },
  {
    id: 'dependabot-secrets',
    label: 'No Dependabot secrets',
    needsPublic: false,
    read: '/repos/{repo}/dependabot/secrets',
    expect: { kind: 'fields', fields: { total_count: 0 } },
    apply: { byHand: 'delete each secret (Settings, Secrets and variables, Dependabot)' },
  },
  {
    id: 'codespaces-secrets',
    label: 'No Codespaces secrets',
    needsPublic: false,
    read: '/repos/{repo}/codespaces/secrets',
    expect: { kind: 'fields', fields: { total_count: 0 } },
    apply: { byHand: 'delete each secret (Settings, Secrets and variables, Codespaces)' },
  },
  {
    id: 'collaborators',
    label: 'Collaborators: the owner only',
    needsPublic: false,
    read: '/repos/{repo}/collaborators?affiliation=all&per_page=100',
    expect: { kind: 'only', field: 'login', values: ['{owner}'] },
    apply: { byHand: 'remove every other collaborator (Settings, Collaborators)' },
  },
  {
    id: 'invitations',
    label: 'No pending collaborator invitations',
    needsPublic: false,
    read: '/repos/{repo}/invitations?per_page=100',
    expect: { kind: 'only', field: 'id', values: [] },
    apply: { byHand: 'cancel each pending invitation (Settings, Collaborators)' },
  },
  {
    id: 'deploy-keys',
    label: 'Deploy keys: read-only only',
    needsPublic: false,
    read: '/repos/{repo}/keys?per_page=100',
    expect: { kind: 'each', fields: { read_only: true } },
    apply: { byHand: 'delete each deploy key with write access, and add it back read-only (Settings, Deploy keys)' },
  },
  {
    id: 'wiki-projects',
    label: 'Wiki and Projects off',
    needsPublic: false,
    read: '/repos/{repo}',
    expect: { kind: 'fields', fields: FEATURES_OFF },
    apply: [{ method: 'PATCH', path: '/repos/{repo}', body: FEATURES_OFF }],
  },
]
