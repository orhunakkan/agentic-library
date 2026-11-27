import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseMailEvent } from '~/server/mail/webhook-input'

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../fixtures/mail/${name}.json`, import.meta.url), 'utf8')) as {
    type: string
    data: Record<string, unknown> & { bounce?: Record<string, unknown> }
  }

const bounced = fixture('email.bounced')
const withBounceType = (type: unknown) => ({
  ...bounced,
  data: { ...bounced.data, bounce: { ...bounced.data.bounce, type } },
})

describe('parseMailEvent', () => {
  it('marks a permanent bounce, a complaint and a suppressed send', () => {
    expect(parseMailEvent(bounced)).toEqual({ kind: 'bounce', to: ['delivered@resend.dev'] })
    expect(parseMailEvent(fixture('email.complained'))).toEqual({ kind: 'complaint', to: ['delivered@resend.dev'] })
    expect(parseMailEvent(fixture('email.suppressed'))).toEqual({ kind: 'suppressed', to: ['delivered@resend.dev'] })
  })

  it('ignores every other bounce type, whatever Resend calls it', () => {
    expect(parseMailEvent(withBounceType('Transient'))).toBeNull()
    expect(parseMailEvent(withBounceType('Temporary'))).toBeNull()
    expect(parseMailEvent(withBounceType('Undetermined'))).toBeNull()
    expect(parseMailEvent(withBounceType('permanent'))).toBeNull()
    expect(parseMailEvent(withBounceType(undefined))).toBeNull()
    expect(parseMailEvent({ ...bounced, data: { ...bounced.data, bounce: 'Permanent' } })).toBeNull()
    const { bounce: _, ...noBounce } = bounced.data
    expect(parseMailEvent({ ...bounced, data: noBounce })).toBeNull()
  })

  it('marks every address in `to`, once each, and skips what isn’t one', () => {
    const to = ['Ann@Example.com', 'ann@example.com', 'Bob <bob@example.org>', 'not an address', 42, null]
    expect(parseMailEvent({ ...bounced, data: { ...bounced.data, to } })).toEqual({
      kind: 'bounce',
      to: ['ann@example.com', 'bob@example.org'],
    })
  })

  it('ignores an event without addresses', () => {
    expect(parseMailEvent({ ...bounced, data: { ...bounced.data, to: [] } })).toBeNull()
    expect(parseMailEvent({ ...bounced, data: { ...bounced.data, to: 'ann@example.com' } })).toBeNull()
    const { to: _, ...noTo } = bounced.data
    expect(parseMailEvent({ ...bounced, data: noTo })).toBeNull()
  })

  it('ignores other event types and wrong shapes', () => {
    for (const type of ['email.delivered', 'email.sent', 'email.opened', 'email.failed', 'contact.created', 7])
      expect(parseMailEvent({ ...bounced, type }), String(type)).toBeNull()
    expect(parseMailEvent(null)).toBeNull()
    expect(parseMailEvent([bounced])).toBeNull()
    expect(parseMailEvent('email.bounced')).toBeNull()
    expect(parseMailEvent({ type: 'email.complained' })).toBeNull()
    expect(parseMailEvent({ type: 'email.complained', data: [] })).toBeNull()
  })
})
