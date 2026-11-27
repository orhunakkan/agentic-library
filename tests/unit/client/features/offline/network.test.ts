import { notFound, redirect } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { isNetworkFailure } from '~/client/features/offline/network'

describe('isNetworkFailure', () => {
  it('is a fetch’s TypeError, or any error while the browser is offline', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'), { onLine: true })).toBe(true)
    expect(isNetworkFailure(new Error('boom'), { onLine: false })).toBe(true)
  })

  it('lets a 404, a redirect and a server error through', () => {
    expect(isNetworkFailure(notFound(), { onLine: false })).toBe(false)
    expect(isNetworkFailure(redirect({ href: '/login' }), { onLine: false })).toBe(false)
    expect(isNetworkFailure(new Error('500'), { onLine: true })).toBe(false)
    expect(isNetworkFailure(new Error('500'), undefined)).toBe(false)
    expect(isNetworkFailure(new Error('500'))).toBe(false)
  })
})
