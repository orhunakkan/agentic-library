import '@tanstack/react-start/server-only'
import { NO_STORE, noStoreText, requestIp, sessionForRequest, toSignIn } from '../auth.ts'
import { getConfig } from '../config.ts'
import { getDb, isDatabaseConfigured } from '../db.ts'
import { take } from '../quota.ts'
import { EXPORT_LIMIT } from '../rate-limit.ts'
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
    const taken = await take(db, session.userId, 'export', { now, ip: requestIp(request) })
    if (!taken.ok) return noStoreText(429, LIMITED)

    const [rows, catalog] = await Promise.all([readAccount(db, session.userId), loadCatalog()])
    if (!rows) return noStoreText(404, 'Not found')
    const titles = new Map(catalog.books.map((b) => [b.slug, b.title]))
    const json = JSON.stringify(toAccountExport(rows, { now, origin: getConfig().appOrigin, titles }), null, 2)
    const bytes = Buffer.byteLength(json)
    await taken.settle({ bytes })
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
