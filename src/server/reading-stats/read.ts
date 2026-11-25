import '@tanstack/react-start/server-only'
import type { ReadingStatsState, ReadingSummaryState } from '~/shared/reading-stats/contract'
import { dayIn, isTimeZone } from '~/shared/reading-stats/days'
import { labelRows } from '../books/book.ts'
import type { Db } from '../db.ts'
import { signedInRead } from '../signed-in.ts'
import { dayTotals, type FinishedRow, goalHistory, listFinished, timeZoneOf } from './store.ts'
import { type ResolvedFinished, toStatsState, toSummaryState } from './view.ts'

async function zoneOf(db: Db, userId: number): Promise<string> {
  const zone = await timeZoneOf(db, userId)
  return zone && isTimeZone(zone) ? zone : 'UTC'
}

async function resolveFinished(db: Db, userId: number, rows: readonly FinishedRow[]): Promise<ResolvedFinished[]> {
  const labelled = await labelRows(db, userId, rows, (r) => r.ref)
  return labelled.flatMap(({ row, slug: book, label }) =>
    label.href ? [{ book, title: label.title, href: label.href, finishedAt: row.finishedAt }] : [],
  )
}

export const statsState = (request: Request): Promise<ReadingStatsState> =>
  signedInRead(request, 'reading stats read', async ({ session: { userId }, db }) => {
    const [totals, history, zone, finished] = await Promise.all([
      dayTotals(db, userId),
      goalHistory(db, userId),
      zoneOf(db, userId),
      listFinished(db, userId),
    ])
    const today = dayIn(new Date(), zone)
    return toStatsState({ today, zone, totals, history, finished: await resolveFinished(db, userId, finished) })
  })

export const summaryState = (request: Request): Promise<ReadingSummaryState> =>
  signedInRead(request, 'reading stats read', async ({ session: { userId }, db }) => {
    const [totals, history, zone] = await Promise.all([
      dayTotals(db, userId),
      goalHistory(db, userId),
      zoneOf(db, userId),
    ])
    return toSummaryState({ today: dayIn(new Date(), zone), zone, totals, history })
  })
