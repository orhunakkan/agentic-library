import { rotateKeys } from '../../src/server/api-keys.ts'
import { getConfig } from '../../src/server/config.ts'
import { closeDb, getDb } from '../../src/server/db.ts'

try {
  const { kek, kekPrevious } = getConfig()
  if (!kek) throw new Error('no KEK configured (the kek credential or the KEK variable)')
  const { rotated, unreadable } = await getDb().begin((tx) => rotateKeys(tx, kek, kekPrevious))
  console.log(`rotate-kek: ${rotated} key(s) re-encrypted with KEK ${kek.id}`)
  if (unreadable > 0) {
    console.error(
      `rotate-kek: ${unreadable} key(s) are under a KEK that is neither KEK nor KEK_PREVIOUS; left as they are`,
    )
    process.exitCode = 1
  }
} catch (error) {
  console.error(`rotate-kek: ${(error as Error).message}`)
  process.exitCode = 1
} finally {
  await closeDb()
}
