import { relativeTime } from '~/client/lib/format'
import { isNewer, type ReadingPlace } from '~/shared/sync/sync'

const UNKNOWN_DEVICE = 'Unknown device'

export function offerFor({
  account,
  currentHref,
  baseline,
  dismissedAt,
}: {
  account: ReadingPlace | null
  currentHref: string
  baseline: number
  dismissedAt: number
}): ReadingPlace | null {
  if (!account || account.href === currentHref) return null
  return isNewer(account.at, baseline) && isNewer(account.at, dismissedAt) ? account : null
}

export function offerText(place: ReadingPlace, now: number): string {
  const where = place.device && place.device !== UNKNOWN_DEVICE ? `in ${place.device}` : 'on another device'
  return `You were on ${place.label} ${where}, ${relativeTime(place.at, now)}.`
}
