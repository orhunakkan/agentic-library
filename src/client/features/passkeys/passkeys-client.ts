import { isObject } from '~/shared/lib/json-shape'
import type {
  AddPasskeyError,
  AuthenticationCredentialJSON,
  CreationOptionsJSON,
  PasskeyView,
  RegistrationCredentialJSON,
  RequestOptionsJSON,
  SignInError,
} from '~/shared/passkeys/passkeys'
import { type ChangeResult, post } from '../../lib/post'
import { authenticationJSON, creationOptions, registrationJSON, requestOptions } from './passkey-json'

export type AddProblem = AddPasskeyError | 'network'
export type SignInProblem = SignInError | 'network'

export type Problem<P extends string> = { kind: 'server'; code: P } | { kind: 'browser'; name: string }

export type CeremonyResult<T, P extends string> = { ok: true; value: T } | { ok: false; problem: Problem<P> }

export type Credentials = Pick<CredentialsContainer, 'create' | 'get'>

const ADD_ERRORS: readonly AddPasskeyError[] = [
  'signed_out',
  'invalid',
  'password',
  'quota',
  'expired',
  'refused',
  'taken',
  'failed',
]
const SIGN_IN_ERRORS: readonly SignInError[] = ['invalid', 'refused', 'limited', 'unavailable']

async function send<T, P extends string>(
  request: () => Promise<Response>,
  pick: (body: Record<string, unknown>) => T | undefined,
  known: readonly P[],
  fallback: P,
): Promise<ChangeResult<T, P | 'network'>> {
  let response: Response
  try {
    response = await request()
  } catch {
    return { ok: false, problem: 'network' }
  }
  const body: unknown = await response.json().catch(() => null)
  const fields = isObject(body) ? body : {}
  if (response.ok) {
    const value = pick(fields)
    return value === undefined ? { ok: false, problem: fallback } : { ok: true, value }
  }
  const code = known.find((k) => k === fields.error)
  return { ok: false, problem: code ?? fallback }
}

const options = <T>(body: Record<string, unknown>) => (isObject(body.options) ? (body.options as T) : undefined)

export function startAdding(password: string): Promise<ChangeResult<CreationOptionsJSON, AddProblem>> {
  return send(() => post('/account/passkeys/options', { password }), options<CreationOptionsJSON>, ADD_ERRORS, 'failed')
}

export function finishAdding(credential: RegistrationCredentialJSON): Promise<ChangeResult<PasskeyView, AddProblem>> {
  return send(
    () => post('/account/passkeys/new', { credential }),
    (body) => (isObject(body.passkey) ? (body.passkey as unknown as PasskeyView) : undefined),
    ADD_ERRORS,
    'failed',
  )
}

export function startSignIn(): Promise<ChangeResult<RequestOptionsJSON, SignInProblem>> {
  return send(
    () => fetch('/passkeys/challenge', { method: 'POST' }),
    options<RequestOptionsJSON>,
    SIGN_IN_ERRORS,
    'unavailable',
  )
}

export function finishSignIn(
  credential: AuthenticationCredentialJSON,
  next: string | undefined,
): Promise<ChangeResult<string, SignInProblem>> {
  return send(
    () => post('/passkeys/sign-in', next ? { credential, next } : { credential }),
    (body) => (typeof body.next === 'string' ? body.next : undefined),
    SIGN_IN_ERRORS,
    'unavailable',
  )
}

export function browserErrorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
    ? error.name
    : ''
}

const server = <P extends string>(code: P) => ({ ok: false as const, problem: { kind: 'server' as const, code } })
const browser = (name: string) => ({ ok: false as const, problem: { kind: 'browser' as const, name } })

async function prompt(ask: () => Promise<Credential | null>): Promise<{ credential: unknown } | { name: string }> {
  try {
    const credential = await ask()
    return credential ? { credential } : { name: 'NotAllowedError' }
  } catch (error) {
    return { name: browserErrorName(error) }
  }
}

export async function addPasskey(
  password: string,
  credentials: Credentials,
): Promise<CeremonyResult<PasskeyView, AddProblem>> {
  const started = await startAdding(password)
  if (!started.ok) return server(started.problem)
  const made = await prompt(() => credentials.create({ publicKey: creationOptions(started.value) }))
  if ('name' in made) return browser(made.name)
  const finished = await finishAdding(registrationJSON(made.credential as Parameters<typeof registrationJSON>[0]))
  return finished.ok ? finished : server(finished.problem)
}

export async function signInWithPasskey(
  next: string | undefined,
  credentials: Credentials,
): Promise<CeremonyResult<string, SignInProblem>> {
  const started = await startSignIn()
  if (!started.ok) return server(started.problem)
  const picked = await prompt(() => credentials.get({ publicKey: requestOptions(started.value) }))
  if ('name' in picked) return browser(picked.name)
  const finished = await finishSignIn(
    authenticationJSON(picked.credential as Parameters<typeof authenticationJSON>[0]),
    next,
  )
  return finished.ok ? finished : server(finished.problem)
}
