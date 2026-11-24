import '@tanstack/react-start/server-only'
import type { FinishedErrorCode, GoalErrorCode } from '~/shared/reading-stats/contract'
import { dayIn } from '~/shared/reading-stats/days'
import { noStoreJson } from '../auth.ts'
import { openBook } from '../books/book.ts'
import { signedInEndpoints } from '../signed-in.ts'
import { parseFinished, parseGoal } from './input.ts'
import { markFinished, setGoal, unmarkFinished } from './store.ts'

const MAX_BODY_BYTES = 1024

const stats = signedInEndpoints<GoalErrorCode | FinishedErrorCode>({ maxBytes: MAX_BODY_BYTES })

export const handleGoal = (request: Request) =>
  stats.post(request, { log: 'reading goal', parse: parseGoal }, async ({ session, db, input }) => {
    const fromDay = dayIn(new Date(), input.zone)
    await setGoal(db, session.userId, fromDay, input.minutes, input.zone)
    return noStoreJson(200, { goal: { minutes: input.minutes, fromDay } })
  })

export const handleFinished = (request: Request) =>
  stats.post(request, { log: 'finished book', parse: parseFinished }, async ({ session, db, input }) => {
    const { userId } = session
    const found = await openBook(db, userId, input.book)
    if (!found) return stats.fail(404, 'not_found')
    const { ref } = found
    if (!input.finished) {
      await unmarkFinished(db, userId, ref)
      return noStoreJson(200, { book: input.book, finished: false, added: false })
    }
    const result = await markFinished(db, userId, ref)
    if (result === 'missing') return stats.fail(404, 'not_found')
    return noStoreJson(200, { book: input.book, finished: true, added: result === 'added' })
  })
