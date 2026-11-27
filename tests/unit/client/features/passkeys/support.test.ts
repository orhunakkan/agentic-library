import { describe, expect, it } from 'vitest'
import { canUsePasskeys } from '~/client/features/passkeys/support'

const navigatorWith = (credentials: unknown) => ({ credentials }) as unknown as Navigator
const both = { create: () => {}, get: () => {} }
class FakeCredential {}

describe('canUsePasskeys', () => {
  it('needs PublicKeyCredential and navigator.credentials’ create and get', () => {
    expect(canUsePasskeys({ PublicKeyCredential: FakeCredential, navigator: navigatorWith(both) })).toBe(true)
    expect(canUsePasskeys({ navigator: navigatorWith(both) })).toBe(false)
    expect(canUsePasskeys({ PublicKeyCredential: {}, navigator: navigatorWith(both) })).toBe(false)
    expect(canUsePasskeys({ PublicKeyCredential: FakeCredential, navigator: navigatorWith(undefined) })).toBe(false)
    expect(canUsePasskeys({ PublicKeyCredential: FakeCredential, navigator: navigatorWith({ get: () => {} }) })).toBe(
      false,
    )
    expect(canUsePasskeys({ PublicKeyCredential: FakeCredential })).toBe(false)
  })

  it('is false under Node, which has no WebAuthn', () => {
    expect(canUsePasskeys()).toBe(false)
  })
})
