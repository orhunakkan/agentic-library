import '@tanstack/react-start/server-only'
import { eventTimes, recordEvent } from '../audit.ts'
import { NO_STORE, noStoreText, requestIp, sessionForRequest, toSignIn } from '../auth.ts'
import { getConfig } from '../config.ts'
import { getDb, isDatabaseConfigured } from '../db.ts'
import { EXPORT_LIMIT, overLimit } from '../rate-limit.ts'
import { logError } from '../redact.ts'
import { loadCatalog } from '../repository.ts'
import { exportFileName, toAccountExport } from './export.ts'
import { readAccount } from './store.ts'

const FAILED = 'Something went wrong. Try again in a few minutes.'
const LIMITED = `You’ve downloaded your data ${EXPORT_LIMIT.max} times in the last hour. Try again later.`

export async function handleAccountExport(request: Request): Promise<Response> {
  const session = isDatabaseConfigured() ? await sessionForRequest(request) : null
  if (!session) return toSignIn('/account#data')
  try {
    const db = getDb()
    const now = new Date()
    const recent = await eventTimes(
      db,
      session.userId,
      ['account.exported'],
      new Date(now.getTime() - EXPORT_LIMIT.windowMs),
    )
    if (overLimit(recent, EXPORT_LIMIT, now)) return noStoreText(429, LIMITED)

    const [rows, catalog] = await Promise.all([readAccount(db, session.userId), loadCatalog()])
    if (!rows) return noStoreText(404, 'Not found')
    const titles = new Map(catalog.books.map((b) => [b.slug, b.title]))
    const json = JSON.stringify(toAccountExport(rows, { now, origin: getConfig().appOrigin, titles }), null, 2)
    const bytes = Buffer.byteLength(json)
    await recordEvent(db, 'account.exported', { userId: session.userId, ip: requestIp(request), detail: { bytes } })
    return new Response(json, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${exportFileName(rows.account.username, now)}"`,
        'cache-control': NO_STORE,
      },
    })
  } catch (error) {
    logError('account export', error)
    return noStoreText(500, FAILED)
  }
}
