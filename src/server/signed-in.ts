import '@tanstack/react-start/server-only'
import {
  type ApiCaller,
  apiCaller,
  loginHref,
  noStoreJson,
  seeOther,
  sessionForRequest,
  signedInCaller,
} from './auth.ts'
import { getDb, isDatabaseConfigured, type Pool } from './db.ts'
import { type JsonBodyProblem, PROBLEM_STATUS, readBytesBody, readForm, readJsonBody } from './json-body.ts'
import { logError } from './redact.ts'
import type { SessionUser } from './sessions.ts'

export interface Codes<C extends string> {
  signedOut: C
  invalid: C
  failed: C
  notFound?: C
  tooLarge?: C
}

export const SNAKE = { signedOut: 'signed_out', invalid: 'invalid', notFound: 'not_found', failed: 'failed' } as const

type SnakeCode = (typeof SNAKE)[keyof typeof SNAKE]

export type Body = { json: number } | { bytes: number; types: readonly string[] } | 'none'

export interface RawBody {
  bytes: Uint8Array
  type: string
}

export type BodyValue<B extends Body> = B extends { bytes: number } ? RawBody : B extends 'none' ? undefined : unknown

export interface Gate {
  session: SessionUser
  db: Pool
  via: 'cookie' | 'token'
  tokenId: string | null
}

function gateFor(session: SessionUser, via: Gate['via'], tokenId: string | null): Gate {
  let db: Pool | undefined
  return {
    session,
    via,
    tokenId,
    get db() {
      db ??= getDb()
      return db
    },
  }
}

export interface HandlerSpec<B extends Body, P, I> {
  log: string
  signedOut?: 401 | 404
  body?: B
  before?: (gate: Gate) => P | Response | Promise<P | Response>
  parse?: (value: BodyValue<B>, pre: P) => I | null | Response
}

export interface Group<C extends string> {
  via?: 'cookie' | 'api'
  maxBytes: number
  codes?: Codes<C>
}

type Grouping<C extends string> = Group<C> & (SnakeCode extends C ? unknown : { codes: Codes<C> })

export function signedInEndpoints<C extends string>(group: Grouping<C>) {
  const codes: Codes<C> = group.codes ?? (SNAKE as Codes<SnakeCode> as Codes<C>)
  const fail = (status: number, error: C, extra: object = {}) => noStoreJson(status, { error, ...extra })

  async function caller(request: Request, signedOut: () => Response): Promise<ApiCaller> {
    if (group.via === 'api') return apiCaller(request, signedOut)
    const who = await signedInCaller(request, signedOut)
    return who.ok ? { ...who, via: 'cookie', tokenId: null } : who
  }

  async function readBody(request: Request, body: Body): Promise<{ value: unknown } | Response> {
    if (body === 'none') return { value: undefined }
    if ('json' in body) {
      const read = await readJsonBody(request, body.json)
      return read.ok ? { value: read.value } : refuse(read.reason)
    }
    const read = await readBytesBody(request, body.bytes, body.types)
    return read.ok ? { value: { bytes: read.bytes, type: read.type } } : refuse(read.reason)
  }

  function refuse(problem: JsonBodyProblem): Response {
    const code = problem === 'too-large' ? (codes.tooLarge ?? codes.invalid) : codes.invalid
    return fail(PROBLEM_STATUS[problem], code)
  }

  async function post<B extends Body = { json: number }, P = undefined, I = BodyValue<B>>(
    request: Request,
    spec: HandlerSpec<B, P, I>,
    work: (ctx: Gate & { pre: P; input: I }) => Promise<Response>,
  ): Promise<Response> {
    const signedOut = () =>
      spec.signedOut === 404 ? fail(404, codes.notFound ?? codes.signedOut) : fail(401, codes.signedOut)
    const who = await caller(request, signedOut)
    if (!who.ok) return who.response
    try {
      const gate = gateFor(who.session, who.via, who.tokenId)
      const pre = spec.before ? await spec.before(gate) : (undefined as P)
      if (pre instanceof Response) return pre
      const body = await readBody(request, spec.body ?? { json: group.maxBytes })
      if (body instanceof Response) return body
      const input = spec.parse ? spec.parse(body.value as BodyValue<B>, pre) : (body.value as I)
      if (input === null) return fail(400, codes.invalid)
      if (input instanceof Response) return input
      return await work(Object.assign(gate, { pre, input }))
    } catch (error) {
      logError(spec.log, error)
      return fail(500, codes.failed)
    }
  }

  return { fail, post }
}

export const MAX_FORM_BYTES = 64 * 1024

export interface FormSpec {
  log: string
  next: string
  before?: (gate: Gate) => Response | undefined
  failed?: (form: FormData) => Response
}

export async function signedInForm(
  request: Request,
  spec: FormSpec,
  work: (ctx: Gate & { form: FormData }) => Promise<Response>,
): Promise<Response> {
  const who = await signedInCaller(request, () => seeOther(loginHref(spec.next)))
  if (!who.ok) return who.response
  let form: FormData | null = null
  try {
    const gate = gateFor(who.session, 'cookie', null)
    const refused = spec.before?.(gate)
    if (refused) return refused
    form = await readForm(request, MAX_FORM_BYTES)
    if (!form) return seeOther(`${spec.next}?error=invalid`)
    return await work(Object.assign(gate, { form }))
  } catch (error) {
    logError(spec.log, error)
    return form && spec.failed ? spec.failed(form) : seeOther(`${spec.next}?error=unavailable`)
  }
}

export async function signedInRead<R, S = { state: 'signed_out' }, U = { state: 'unavailable' }>(
  request: Request,
  log: string,
  work: (gate: Pick<Gate, 'session' | 'db'>) => Promise<R>,
  fallback: { signedOut?: S; unavailable?: U } = {},
): Promise<R | S | U> {
  const signedOut = 'signedOut' in fallback ? (fallback.signedOut as S) : ({ state: 'signed_out' } as S)
  const unavailable = 'unavailable' in fallback ? (fallback.unavailable as U) : ({ state: 'unavailable' } as U)
  if (!isDatabaseConfigured()) return signedOut
  try {
    const session = await sessionForRequest(request)
    if (!session) return signedOut
    return await work(gateFor(session, 'cookie', null))
  } catch (error) {
    logError(log, error)
    return unavailable
  }
}
