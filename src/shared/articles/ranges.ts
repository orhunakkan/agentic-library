export interface AddressRange {
  family: 'ipv4' | 'ipv6'
  network: string
  prefix: number
}

const v4 = (cidr: string): AddressRange => {
  const [network = '', prefix = '0'] = cidr.split('/')
  return { family: 'ipv4', network, prefix: Number(prefix) }
}
const v6 = (cidr: string): AddressRange => {
  const at = cidr.lastIndexOf('/')
  return { family: 'ipv6', network: cidr.slice(0, at), prefix: Number(cidr.slice(at + 1)) }
}

export const BLOCKED_RANGES: readonly AddressRange[] = [
  v4('0.0.0.0/8'),
  v4('10.0.0.0/8'),
  v4('100.64.0.0/10'),
  v4('127.0.0.0/8'),
  v4('169.254.0.0/16'),
  v4('172.16.0.0/12'),
  v4('192.0.0.0/24'),
  v4('192.0.2.0/24'),
  v4('192.88.99.0/24'),
  v4('192.168.0.0/16'),
  v4('198.18.0.0/15'),
  v4('198.51.100.0/24'),
  v4('203.0.113.0/24'),
  v4('224.0.0.0/4'),
  v4('240.0.0.0/4'),
  v6('::/128'),
  v6('::1/128'),
  v6('64:ff9b::/96'),
  v6('64:ff9b:1::/48'),
  v6('100::/64'),
  v6('2001::/23'),
  v6('2001:db8::/32'),
  v6('2002::/16'),
  v6('fc00::/7'),
  v6('fe80::/10'),
  v6('ff00::/8'),
]

export function ipv4Number(text: string): number | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  let address = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    address = address * 256 + value
  }
  return address
}

export function ipv6Number(text: string): bigint | null {
  let address = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text
  address = address.split('%')[0] ?? ''
  if (!address.includes(':')) return null
  const groups: number[] = []
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(address)
  if (tail) {
    const v4value = ipv4Number(tail[1] as string)
    if (v4value === null) return null
    address = `${address.slice(0, -(tail[1] as string).length)}${(v4value >>> 16).toString(16)}:${(v4value & 0xffff).toString(16)}`
  }
  const halves = address.split('::')
  if (halves.length > 2) return null
  const parse = (part: string) => (part === '' ? [] : part.split(':'))
  const head = parse(halves[0] ?? '')
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  for (const group of [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest]) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null
    groups.push(Number.parseInt(group, 16))
  }
  return groups.reduce((n, g) => (n << 16n) | BigInt(g), 0n)
}

export function embeddedIpv4(value: bigint): number | null {
  const high = value >> 32n
  if (high === 0xffffn || high === 0n) return Number(value & 0xffffffffn)
  return null
}

const ipv4Ranges = BLOCKED_RANGES.filter((r) => r.family === 'ipv4').map((r) => ({
  start: ipv4Number(r.network) as number,
  size: 2 ** (32 - r.prefix),
}))
const ipv6Ranges = BLOCKED_RANGES.filter((r) => r.family === 'ipv6').map((r) => {
  const bits = BigInt(128 - r.prefix)
  return { start: ((ipv6Number(r.network) as bigint) >> bits) << bits, bits }
})

export const isBlockedIpv4 = (n: number) => ipv4Ranges.some((r) => n >= r.start && n < r.start + r.size)

export function isBlockedIpv6(value: bigint): boolean {
  const v4value = embeddedIpv4(value)
  if (v4value !== null && isBlockedIpv4(v4value)) return true
  return ipv6Ranges.some((r) => value >> r.bits === r.start >> r.bits)
}

export function blockedAddress(text: string): boolean | null {
  const four = ipv4Number(text)
  if (four !== null) return isBlockedIpv4(four)
  const six = ipv6Number(text)
  return six === null ? null : isBlockedIpv6(six)
}
