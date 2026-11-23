import { describe, expect, it, vi } from 'vitest'
import { registerServiceWorker } from './service-worker'

const navWith = (register = vi.fn(async () => ({}))) => ({ nav: { serviceWorker: { register } }, register })

describe('registerServiceWorker', () => {
  it('registers /sw.js at scope / with updateViaCache none in production', async () => {
    const { nav, register } = navWith()
    await registerServiceWorker({ nav, prod: true, embedded: false })
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
  })

  it('does nothing outside production, when embedded, or without service workers', async () => {
    const dev = navWith()
    await registerServiceWorker({ nav: dev.nav, prod: false, embedded: false })
    expect(dev.register).not.toHaveBeenCalled()
    const framed = navWith()
    await registerServiceWorker({ nav: framed.nav, prod: true, embedded: true })
    expect(framed.register).not.toHaveBeenCalled()
    await expect(registerServiceWorker({ nav: {}, prod: true, embedded: false })).resolves.toBeUndefined()
  })

  it('resolves quietly when registering fails', async () => {
    const { nav } = navWith(
      vi.fn(async () => {
        throw new Error('SecurityError')
      }),
    )
    await expect(registerServiceWorker({ nav, prod: true, embedded: false })).resolves.toBeUndefined()
  })
})
