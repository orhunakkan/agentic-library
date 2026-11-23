import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { captureMail } from './capture'
import type { OutgoingMail } from './resend'

const mail: OutgoingMail = { to: 'ann@example.com', kind: 'confirm', subject: 'Confirm', text: 'Open this link' }
let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'folio-capture-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('captureMail', () => {
  it('writes one JSON file, named by the time without colons', async () => {
    const at = new Date('2026-11-06T14:32:05.123Z')
    const path = await captureMail(dir, 'Folio <no-reply@folio.test>', mail, at)
    expect(basename(path)).toMatch(/^2026-11-06T14-32-05\.123Z-[0-9a-f]{8}\.json$/)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      to: 'ann@example.com',
      from: 'Folio <no-reply@folio.test>',
      subject: 'Confirm',
      text: 'Open this link',
      kind: 'confirm',
      at: '2026-11-06T14:32:05.123Z',
    })
  })

  it('creates a missing folder, and keeps two messages of the same moment apart', async () => {
    const nested = join(dir, 'a', 'b')
    const at = new Date('2026-11-06T14:32:05.123Z')
    await captureMail(nested, 'f@folio.test', mail, at)
    await captureMail(nested, 'f@folio.test', mail, at)
    expect(readdirSync(nested)).toHaveLength(2)
  })
})
