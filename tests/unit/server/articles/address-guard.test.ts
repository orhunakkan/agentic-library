import { describe, expect, it } from 'vitest'
import { blockList, checkAddresses, isBlocked } from '~/server/articles/address-guard'
import { BLOCKED_RANGES, ipv4Number, ipv6Number } from '~/shared/articles/ranges'

const quad = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
const hex = (n: bigint) => (n.toString(16).padStart(32, '0').match(/.{4}/g) as string[]).join(':')

describe('isBlocked', () => {
  it('has the first and last address of every range, and the neighbours outside it', () => {
    const blocked = (n: number) =>
      BLOCKED_RANGES.some((r) => {
        if (r.family !== 'ipv4') return false
        const start = ipv4Number(r.network) as number
        return n >= start && n < start + 2 ** (32 - r.prefix)
      })
    for (const range of BLOCKED_RANGES) {
      if (range.family === 'ipv4') {
        const start = ipv4Number(range.network) as number
        const end = start + 2 ** (32 - range.prefix) - 1
        expect(isBlocked(quad(start)), quad(start)).toBe(true)
        expect(isBlocked(quad(end)), quad(end)).toBe(true)
        if (start > 0) expect(isBlocked(quad(start - 1)), quad(start - 1)).toBe(blocked(start - 1))
        if (end < 2 ** 32 - 1) expect(isBlocked(quad(end + 1)), quad(end + 1)).toBe(blocked(end + 1))
      } else {
        const bits = BigInt(128 - range.prefix)
        const start = ipv6Number(range.network) as bigint
        const end = start + (1n << bits) - 1n
        expect(isBlocked(hex(start)), hex(start)).toBe(true)
        expect(isBlocked(hex(end)), hex(end)).toBe(true)
      }
    }
  })

  it('stops at the IPv6 edges', () => {
    for (const text of [
      '2001:200::',
      '2001:db9::',
      '2003::',
      'fe00::',
      'fec0::',
      '64:ff9b::1:0:0',
      '64:ff9b:2::',
      '2606:4700::1111',
    ])
      expect(isBlocked(text), text).toBe(false)
    for (const text of [
      '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff',
      '64:ff9b::7f00:1',
      '64:ff9b:1::1',
      'fdff::1',
      'febf::1',
      'ff02::1',
    ])
      expect(isBlocked(text), text).toBe(true)
  })

  it('checks the mapped and compatible forms as IPv4', () => {
    expect(isBlocked('::ffff:127.0.0.1')).toBe(true)
    expect(isBlocked('::ffff:7f00:1')).toBe(true)
    expect(isBlocked('::ffff:10.0.0.1')).toBe(true)
    expect(isBlocked('::ffff:169.254.169.254')).toBe(true)
    expect(isBlocked('::127.0.0.1')).toBe(true)
    expect(isBlocked('::ffff:8.8.8.8')).toBe(false)
  })

  it('refuses what is not an address', () => {
    expect(isBlocked('example.com')).toBe(true)
    expect(isBlocked('')).toBe(true)
  })

  it('builds the list once', () => expect(blockList()).toBe(blockList()))
})

describe('checkAddresses', () => {
  it('needs every address public', () => {
    expect(checkAddresses([{ address: '93.184.216.34', family: 4 }])).toBe(true)
    expect(
      checkAddresses([
        { address: '93.184.216.34', family: 4 },
        { address: '2606:4700::1111', family: 6 },
      ]),
    ).toBe(true)
    expect(
      checkAddresses([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ]),
    ).toBe(false)
    expect(checkAddresses([])).toBe(false)
  })
})
