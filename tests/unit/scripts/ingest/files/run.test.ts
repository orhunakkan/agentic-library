import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { COLLECTION } from '../../../../../scripts/ingest/files/config.ts'
import { importCollection } from '../../../../../scripts/ingest/files/run.ts'

const scratch = mkdtempSync(join(tmpdir(), 'ingest-run-test-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const plan = (contentDir: string) => ({
  collection: COLLECTION,
  series: [],
  books: [],
  sourceDir: join(scratch, 'sources'),
  contentDir,
})

it('writes no catalogue file, and no folders, when there are no books', async () => {
  const contentDir = join(scratch, 'fresh')
  await importCollection(plan(contentDir))
  expect(existsSync(contentDir)).toBe(false)
})

it('removes the catalogue file a collection with no books left behind', async () => {
  const contentDir = join(scratch, 'stale')
  const catalogPath = join(contentDir, 'catalog', `${COLLECTION.slug}.json`)
  mkdirSync(join(contentDir, 'catalog'), { recursive: true })
  writeFileSync(catalogPath, '{}')
  await importCollection(plan(contentDir))
  expect(existsSync(catalogPath)).toBe(false)
})
