import { isIP } from 'node:net'
import { SITE_NAME } from '../../shared/lib/site.ts'

export interface RelyingParty {
  rpID: string
  origin: string
  rpName: string
}

export function rpFor(appOrigin: string): RelyingParty {
  const url = new URL(appOrigin)
  const host = url.hostname
  if (isIP(host.replace(/^\[(.*)\]$/, '$1')))
    throw new Error(`Passkeys need APP_ORIGIN to be a hostname, not an IP address (${host})`)
  return { rpID: host, origin: url.origin, rpName: SITE_NAME }
}
