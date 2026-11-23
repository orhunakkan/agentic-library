import '@tanstack/react-start/server-only'
import { BlockList, isIP } from 'node:net'
import { BLOCKED_RANGES, embeddedIpv4, ipv6Number } from '../../shared/articles/ranges.ts'

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

let built: BlockList | null = null

export function blockList(): BlockList {
  if (built) return built
  const list = new BlockList()
  for (const range of BLOCKED_RANGES) list.addSubnet(range.network, range.prefix, range.family)
  built = list
  return list
}

const quad = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')

export function isBlocked(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return blockList().check(address, 'ipv4')
  if (family !== 6) return true
  const value = ipv6Number(address)
  if (value === null) return true
  const v4 = embeddedIpv4(value)
  if (v4 !== null && blockList().check(quad(v4), 'ipv4')) return true
  return blockList().check(address, 'ipv6')
}

export function checkAddresses(addresses: readonly ResolvedAddress[]): boolean {
  return addresses.length > 0 && !addresses.some((a) => isBlocked(a.address))
}
