import { describe, expect, it } from 'vitest'
import {
  addressChangedNotice,
  confirmMessage,
  mailDate,
  maskEmail,
  passkeyAddedNotice,
  passwordResetNotice,
  resetMessage,
  signupMessage,
} from './messages'

const origin = 'https://agenticlibrary.app'
const at = new Date('2026-11-06T14:32:59Z')
const count = (text: string, part: string) => text.split(part).length - 1

describe('confirmMessage', () => {
  const link = `${origin}/confirm-email?token=abc`
  const message = confirmMessage({ email: 'ann@example.com', link, origin })

  it('says what it is for and how long it works', () => {
    expect(message.kind).toBe('confirm')
    expect(message.subject).toBe('Confirm your email address for Folio')
    expect(message.text).toBe(
      [
        'Hello,',
        'Open this link to confirm ann@example.com as the email address of your Folio account:',
        link,
        'It works for 24 hours, and only while you’re signed in to the account that asked. Until then Folio won’t use this address. If you didn’t ask for this, ignore this email.',
        '— Folio, https://agenticlibrary.app',
      ].join('\n\n'),
    )
  })

  it('has the link once and no username', () => {
    expect(count(message.text, link)).toBe(1)
    expect(message.text).not.toMatch(/account “/)
  })
})

describe('resetMessage', () => {
  it('names the account and has the link once', () => {
    const link = `${origin}/reset-password?token=xyz`
    const message = resetMessage({ username: 'ann', link, origin })
    expect([message.kind, message.subject]).toEqual(['reset', 'Reset your Folio password'])
    expect(message.text).toContain('Hello ann,')
    expect(message.text).toContain('the Folio account “ann”. To choose a new one, open this link:')
    expect(message.text).toContain('It works once, for 30 minutes.')
    expect(count(message.text, link)).toBe(1)
  })
})

describe('the notices', () => {
  it('say when the password was reset, in UTC', () => {
    const message = passwordResetNotice({ username: 'ann', at, origin })
    expect([message.kind, message.subject]).toEqual(['password-reset', 'Your Folio password was reset'])
    expect(message.text).toContain(
      'The password of the Folio account “ann” was reset on 6 November 2026 at 14:32 UTC, from a link sent to this address.',
    )
  })

  it('show the new address masked', () => {
    const message = addressChangedNotice({ username: 'ann', newEmail: 'ann.new@example.org', at, origin })
    expect([message.kind, message.subject]).toEqual(['address-changed', 'Your Folio email address was changed'])
    expect(message.text).toContain('was changed from this address to a…@example.org on 6 November 2026 at 14:32 UTC.')
    expect(message.text).not.toContain('ann.new')
  })
})

describe('maskEmail', () => {
  it('keeps the first character and the domain', () => {
    expect(maskEmail('nora@example.com')).toBe('n…@example.com')
    expect(maskEmail('ab@example.com')).toBe('a…@example.com')
  })

  it('keeps nothing of a one-character local part', () => {
    expect(maskEmail('a@example.com')).toBe('…@example.com')
  })
})

describe('mailDate', () => {
  it('uses UTC and pads the time', () => {
    expect(mailDate(new Date('2027-01-02T03:04:00Z'))).toBe('2 January 2027 at 03:04 UTC')
    expect(mailDate(new Date('2026-12-31T23:59:00-05:00'))).toBe('1 January 2027 at 04:59 UTC')
  })
})

describe('signupMessage', () => {
  const link = `${origin}/signup?token=abc`

  it('carries the link and says it works once, for 24 hours', () => {
    const message = signupMessage({ link, origin, existing: [] })
    expect(message.kind).toBe('signup')
    expect(message.subject).toBe('Finish signing up for Folio')
    expect(message.text).toBe(
      [
        'Hello,',
        'Someone asked to create a Folio account with this address. To choose a username and password, open this link:',
        link,
        'It works once, for 24 hours. If you didn’t ask for this, ignore this email: no account is made.',
        `— Folio, ${origin}`,
      ].join('\n\n'),
    )
    expect(message.text).not.toContain('forgot-password')
  })

  it('names one account that already uses the address, and how to get back in', () => {
    const { text } = signupMessage({ link, origin, existing: ['ann'] })
    expect(text).toContain(
      `This address already belongs to the Folio account “ann”. To get back into it, reset its password: ${origin}/forgot-password`,
    )
    expect(count(text, link)).toBe(1)
  })

  it('names several', () => {
    expect(signupMessage({ link, origin, existing: ['ann', 'bob'] }).text).toContain(
      'the Folio accounts “ann” and “bob”. To get back into one,',
    )
    expect(signupMessage({ link, origin, existing: ['ann', 'bob', 'cy'] }).text).toContain('“ann”, “bob” and “cy”')
  })

  it('is plain text', () => {
    expect(signupMessage({ link, origin, existing: ['ann'] }).text).not.toMatch(/<[a-z]/i)
  })
})

describe('passkeyAddedNotice', () => {
  it('names the passkey and the account, says what to do, and has no link', () => {
    const message = passkeyAddedNotice({ username: 'ann', name: 'Chrome on macOS', at, origin })
    expect([message.kind, message.subject]).toEqual(['passkey-added', 'A passkey was added to your Folio account'])
    expect(message.text).toContain(
      'A passkey named “Chrome on macOS” was added to your Folio account “ann” on 6 November 2026 at 14:32 UTC. If ' +
        'this wasn’t you, sign in, remove it under Account → Passkeys, and change your password.',
    )
    expect(count(message.text, 'http')).toBe(1)
  })
})
