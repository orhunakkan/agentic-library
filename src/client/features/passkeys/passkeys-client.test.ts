import { describe, expect, it, vi } from 'vitest'
import type { CreationOptionsJSON, RequestOptionsJSON } from '~/shared/passkeys/passkeys'
import {
  addPasskey,
  browserErrorName,
  type Credentials,
  finishAdding,
  finishSignIn,
  signInWithPasskey,
  startAdding,
  startSignIn,
} from './passkeys-client'

const CREATION: CreationOptionsJSON = {
  rp: { name: 'Folio', id: 'localhost' },
  user: { id: 'AQID', name: 'ann', displayName: 'ann' },
  challenge: 'AAEC',
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
}
const REQUEST: RequestOptionsJSON = { challenge: 'AAEC', rpId: 'localhost' }
const PASSKEY = {
  id: 'p1',
  name: 'Chrome on macOS',
  createdAt: '2026-11-18T10:00:00Z',
  lastUsedAt: null,
  backedUp: false,
}
const buf = (...values: number[]) => new Uint8Array(values).buffer

const REGISTRATION = {
  id: 'AQID',
  rawId: buf(1, 2, 3),
  type: 'public-key',
  authenticatorAttachment: 'platform',
  response: { clientDataJSON: buf(7), attestationObject: buf(8), getTransports: () => ['internal'] },
}
const ASSERTION = {
  id: 'AQID',
  rawId: buf(1, 2, 3),
  type: 'public-key',
  authenticatorAttachment: 'platform',
  response: { clientDataJSON: buf(7), authenticatorData: buf(10), signature: buf(12), userHandle: buf(13) },
}

function answers(...replies: ([number, unknown] | 'offline')[]) {
  const fetch = vi.fn(async () => {
    const reply = replies.shift()
    if (!reply || reply === 'offline') throw new TypeError('Failed to fetch')
    const [status, body] = reply
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const sent = (fetch: ReturnType<typeof answers>, call: number) => {
  const [path, init] = fetch.mock.calls[call] as unknown as [string, RequestInit]
  return { path, body: init.body ? JSON.parse(String(init.body)) : undefined, method: init.method }
}

describe('adding', () => {
  it('asks for options with the password', async () => {
    const fetch = answers([200, { options: CREATION }])
    expect(await startAdding('secret')).toEqual({ ok: true, value: CREATION })
    expect(sent(fetch, 0)).toEqual({ path: '/account/passkeys/options', body: { password: 'secret' }, method: 'POST' })
  })

  it('sends the credential and gets the passkey', async () => {
    const fetch = answers([200, { passkey: PASSKEY }])
    const credential = { id: 'a', rawId: 'a', type: 'public-key', response: {}, clientExtensionResults: {} }
    expect(await finishAdding(credential as never)).toEqual({ ok: true, value: PASSKEY })
    expect(sent(fetch, 0)).toMatchObject({ path: '/account/passkeys/new', body: { credential } })
  })

  it('maps every refusal to its code, and anything else to failed or network', async () => {
    for (const code of ['signed_out', 'invalid', 'password', 'quota', 'expired', 'refused', 'taken', 'failed']) {
      answers([400, { error: code }])
      expect(await startAdding('x')).toEqual({ ok: false, problem: code })
    }
    answers([500, 'not json'])
    expect(await startAdding('x')).toEqual({ ok: false, problem: 'failed' })
    answers([418, { error: 'teapot' }])
    expect(await startAdding('x')).toEqual({ ok: false, problem: 'failed' })
    answers([200, { nothing: true }])
    expect(await finishAdding({} as never)).toEqual({ ok: false, problem: 'failed' })
    answers([200, { options: [] }])
    expect(await startAdding('x')).toEqual({ ok: false, problem: 'failed' })
    answers([200, { passkey: [] }])
    expect(await finishAdding({} as never)).toEqual({ ok: false, problem: 'failed' })
    answers('offline')
    expect(await startAdding('x')).toEqual({ ok: false, problem: 'network' })
  })
})

describe('signing in', () => {
  it('asks for a challenge with no body', async () => {
    const fetch = answers([200, { options: REQUEST }])
    expect(await startSignIn()).toEqual({ ok: true, value: REQUEST })
    expect(sent(fetch, 0)).toEqual({ path: '/passkeys/challenge', body: undefined, method: 'POST' })
  })

  it('sends the assertion with next only when there is one', async () => {
    const fetch = answers([200, { next: '/account' }], [200, { next: '/library' }])
    expect(await finishSignIn({ id: 'a' } as never, '/account')).toEqual({ ok: true, value: '/account' })
    expect(await finishSignIn({ id: 'a' } as never, undefined)).toEqual({ ok: true, value: '/library' })
    expect(sent(fetch, 0).body).toEqual({ credential: { id: 'a' }, next: '/account' })
    expect(sent(fetch, 1).body).toEqual({ credential: { id: 'a' } })
  })

  it('maps every refusal to its code, and anything else to unavailable or network', async () => {
    for (const code of ['invalid', 'refused', 'limited', 'unavailable']) {
      answers([401, { error: code }])
      expect(await finishSignIn({} as never, undefined)).toEqual({ ok: false, problem: code })
    }
    answers([502, ''])
    expect(await startSignIn()).toEqual({ ok: false, problem: 'unavailable' })
    answers([200, { options: [] }])
    expect(await startSignIn()).toEqual({ ok: false, problem: 'unavailable' })
    answers([200, { next: 3 }])
    expect(await finishSignIn({} as never, undefined)).toEqual({ ok: false, problem: 'unavailable' })
    answers('offline')
    expect(await startSignIn()).toEqual({ ok: false, problem: 'network' })
  })
})

function prompt(
  answer: unknown,
  name?: string,
): Credentials & { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> } {
  const reply = vi.fn(async () => {
    if (name) throw new DOMException('no', name)
    return answer
  })
  return { create: reply, get: reply } as never
}

describe('addPasskey', () => {
  it('checks the password, makes the passkey with the options as bytes, and stores it', async () => {
    const fetch = answers([200, { options: CREATION }], [200, { passkey: PASSKEY }])
    const credentials = prompt(REGISTRATION)
    expect(await addPasskey('secret', credentials)).toEqual({ ok: true, value: PASSKEY })
    const asked = credentials.create.mock.calls[0]?.[0] as CredentialCreationOptions
    expect(new Uint8Array(asked.publicKey?.challenge as ArrayBuffer)).toEqual(new Uint8Array([0, 1, 2]))
    expect(sent(fetch, 1).body.credential).toMatchObject({
      id: 'AQID',
      rawId: 'AQID',
      response: { transports: ['internal'] },
    })
  })

  it('stops at the server’s refusal, before the prompt', async () => {
    answers([400, { error: 'password' }])
    const credentials = prompt(REGISTRATION)
    expect(await addPasskey('wrong', credentials)).toEqual({ ok: false, problem: { kind: 'server', code: 'password' } })
    expect(credentials.create).not.toHaveBeenCalled()
  })

  it('reports the prompt’s error, or nothing as cancelled, without storing anything', async () => {
    const fetch = answers([200, { options: CREATION }], [200, { options: CREATION }])
    expect(await addPasskey('secret', prompt(null, 'InvalidStateError'))).toEqual({
      ok: false,
      problem: { kind: 'browser', name: 'InvalidStateError' },
    })
    expect(await addPasskey('secret', prompt(null))).toEqual({
      ok: false,
      problem: { kind: 'browser', name: 'NotAllowedError' },
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('reports the second request’s refusal', async () => {
    answers([200, { options: CREATION }], [409, { error: 'taken' }])
    expect(await addPasskey('secret', prompt(REGISTRATION))).toEqual({
      ok: false,
      problem: { kind: 'server', code: 'taken' },
    })
  })
})

describe('signInWithPasskey', () => {
  it('gets a challenge, asks the browser and answers where to go', async () => {
    const fetch = answers([200, { options: REQUEST }], [200, { next: '/account' }])
    const credentials = prompt(ASSERTION)
    expect(await signInWithPasskey('/account', credentials)).toEqual({ ok: true, value: '/account' })
    const asked = credentials.get.mock.calls[0]?.[0] as CredentialRequestOptions
    expect(asked.publicKey?.rpId).toBe('localhost')
    expect(sent(fetch, 1).body).toMatchObject({ credential: { response: { userHandle: 'DQ' } }, next: '/account' })
  })

  it('stops at a refused challenge, a cancelled prompt or a refused assertion', async () => {
    answers([429, { error: 'limited' }])
    expect(await signInWithPasskey(undefined, prompt(ASSERTION))).toEqual({
      ok: false,
      problem: { kind: 'server', code: 'limited' },
    })
    answers([200, { options: REQUEST }])
    expect(await signInWithPasskey(undefined, prompt(null, 'AbortError'))).toEqual({
      ok: false,
      problem: { kind: 'browser', name: 'AbortError' },
    })
    answers([200, { options: REQUEST }], [401, { error: 'refused' }])
    expect(await signInWithPasskey(undefined, prompt(ASSERTION))).toEqual({
      ok: false,
      problem: { kind: 'server', code: 'refused' },
    })
  })
})

describe('browserErrorName', () => {
  it('is a DOMException’s name, or nothing', () => {
    expect(browserErrorName(new DOMException('x', 'NotAllowedError'))).toBe('NotAllowedError')
    expect(browserErrorName(new TypeError('x'))).toBe('TypeError')
    expect(browserErrorName('x')).toBe('')
    expect(browserErrorName(null)).toBe('')
    expect(browserErrorName({ name: 3 })).toBe('')
  })
})
