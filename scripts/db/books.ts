import { parseArgs } from 'node:util'
import { closeDb, getDb } from '../../src/server/db.ts'
import { findBooks, OperatorInputError, removeBook } from '../../src/server/operator-books.ts'

const USAGE = `usage: node scripts/db/books.ts <command> --reason <text>
  find <text> --reason <text>       books, audiobooks and articles whose title or author contains <text>, ignoring
                                    case, across every account. Prints titles and authors, never contents
  remove <book-id> --reason <text>  delete that book as its reader's own delete does, and print its owner
Every search and removal is recorded in the activity log with its reason, such as
  --reason "notice 2026-12-01 from Example Press"`

class UsageError extends Error {}

const detail = { via: 'books script', osUser: process.env.USER ?? process.env.USERNAME ?? null }

/** The arguments, or a usage error for an unknown option or a `--reason` with no value. */
function parsed(argv: string[]) {
  try {
    return parseArgs({ args: argv, options: { reason: { type: 'string' } }, allowPositionals: true })
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
}

async function run(argv: string[]): Promise<void> {
  const { positionals, values } = parsed(argv)
  const [command, target, ...extra] = positionals
  if (command !== 'find' && command !== 'remove')
    throw new UsageError(command ? `unknown command "${command}"` : 'missing <command>')
  if (!target) throw new UsageError(command === 'find' ? 'missing <text>' : 'missing <book-id>')
  if (extra.length) throw new UsageError(`unexpected "${extra.join(' ')}"; quote text with spaces`)
  const reason = values.reason?.trim()
  if (!reason) throw new UsageError('--reason is required, saying which notice this is for')
  const db = getDb()
  if (command === 'find') {
    const books = await findBooks(db, target, reason, detail)
    if (!books.length) {
      console.log('no book matches')
      return
    }
    console.table(
      books.map((book) => ({
        id: book.id,
        username: book.username,
        kind: book.kind,
        title: book.title,
        author: book.author,
        'added (UTC)': book.addedAt.toISOString().slice(0, 16).replace('T', ' '),
      })),
    )
    return
  }
  const removed = await removeBook(db, target, reason, detail)
  if (!removed) throw new Error(`no book with id "${target}"; nothing was changed`)
  console.log(
    `removed "${removed.title}" from ${removed.username}'s library\n` +
      (removed.email ? `their confirmed address: ${removed.email}` : 'they have no confirmed address'),
  )
}

try {
  await run(process.argv.slice(2))
} catch (error) {
  console.error(`books: ${(error as Error).message}`)
  if (error instanceof UsageError || error instanceof OperatorInputError) console.error(USAGE)
  process.exitCode = 1
} finally {
  await closeDb()
}
