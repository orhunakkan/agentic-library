import { describe, expect, it } from 'vitest'
import { BLOCKED_RANGES, blockedAddress, embeddedIpv4, ipv4Number, ipv6Number } from './ranges'

describe('ipv4Number', () => {
  it('reads a dotted quad', () => {
    expect(ipv4Number('0.0.0.0')).toBe(0)
    expect(ipv4Number('255.255.255.255')).toBe(2 ** 32 - 1)
    expect(ipv4Number('127.0.0.1')).toBe(0x7f000001)
  })
  it('refuses anything else', () => {
    for (const text of ['1.2.3', '1.2.3.4.5', '256.0.0.1', '1.2.3.x', '', '1..2.3', '1234.0.0.1'])
      expect(ipv4Number(text)).toBeNull()
  })
})

describe('ipv6Number', () => {
  it('reads every compression', () => {
    expect(ipv6Number('::')).toBe(0n)
    expect(ipv6Number('::1')).toBe(1n)
    expect(ipv6Number('[::1]')).toBe(1n)
    expect(ipv6Number('1::')).toBe(1n << 112n)
    expect(ipv6Number('1:2:3:4:5:6:7:8')).toBe(0x00010002000300040005000600070008n)
    expect(ipv6Number('fe80::1%eth0')).toBe((0xfe80n << 112n) | 1n)
  })
  it('reads an IPv4 tail', () => expect(ipv6Number('::ffff:127.0.0.1')).toBe(0xffff7f000001n))
  it('refuses what is not one', () => {
    for (const text of [
      '1.2.3.4',
      '1::2::3',
      '1:2:3:4:5:6:7',
      '1:2:3:4:5:6:7:8:9',
      '::g',
      '::12345',
      '1:2:3:4:5:6:7::8',
      '::1.2.3.256',
    ])
      expect(ipv6Number(text)).toBeNull()
  })
})

describe('embeddedIpv4', () => {
  it('finds mapped and compatible forms only', () => {
    expect(embeddedIpv4(0xffff0a000001n)).toBe(0x0a000001)
    expect(embeddedIpv4(0x7f000001n)).toBe(0x7f000001)
    expect(embeddedIpv4(ipv6Number('2606:4700::1111') as bigint)).toBeNull()
  })
})

describe('blockedAddress', () => {
  it('is null for a name', () => expect(blockedAddress('example.com')).toBeNull())
  it('refuses the private, loopback and metadata addresses', () => {
    for (const text of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '192.168.1.1',
      '::1',
      '::',
      '[::ffff:10.0.0.1]',
      '::ffff:127.0.0.1',
      'fd00::1',
      'fe80::1',
      '64:ff9b::a00:1',
      '2002:7f00:1::',
    ])
      expect(blockedAddress(text)).toBe(true)
  })
  it('lets public addresses through', () => {
    for (const text of ['93.184.216.34', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8', '2a00:1450:4001::1'])
      expect(blockedAddress(text)).toBe(false)
  })
  it('has the edges of every range', () => {
    for (const range of BLOCKED_RANGES) {
      if (range.family === 'ipv4') {
        const start = ipv4Number(range.network) as number
        const end = start + 2 ** (32 - range.prefix) - 1
        const quad = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
        expect(blockedAddress(quad(start)), quad(start)).toBe(true)
        expect(blockedAddress(quad(end)), quad(end)).toBe(true)
      } else {
        const bits = BigInt(128 - range.prefix)
        const start = ipv6Number(range.network) as bigint
        const end = start + (1n << bits) - 1n
        const text = (n: bigint) => (n.toString(16).padStart(32, '0').match(/.{4}/g) as string[]).join(':')
        expect(blockedAddress(text(start)), text(start)).toBe(true)
        expect(blockedAddress(text(end)), text(end)).toBe(true)
      }
    }
  })
  it('stops at each edge', () => {
    const outside = [
      '9.255.255.255',
      '11.0.0.0',
      '100.63.255.255',
      '100.128.0.0',
      '126.255.255.255',
      '128.0.0.0',
      '169.253.255.255',
      '169.255.0.0',
      '172.15.255.255',
      '172.32.0.0',
      '192.0.1.0',
      '192.0.3.0',
      '192.88.98.255',
      '192.88.100.0',
      '192.167.255.255',
      '192.169.0.0',
      '198.17.255.255',
      '198.20.0.0',
      '198.51.99.255',
      '198.51.101.0',
      '203.0.112.255',
      '203.0.114.0',
      '223.255.255.255',
      '1.0.0.0',
    ]
    for (const text of outside) expect(blockedAddress(text), text).toBe(false)
    const outside6 = [
      '64:ff9b::1:0:0',
      '64:ff9b:2::',
      '100::1:0:0:0:0',
      '2001:200::',
      '2001:db7:ffff:ffff:ffff:ffff:ffff:ffff',
      '2001:db9::',
      '2001:ffff::',
      '2003::',
      'fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      'fe00::',
      'fec0::',
      'feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    ]
    for (const text of outside6) expect(blockedAddress(text), text).toBe(false)
  })
})
