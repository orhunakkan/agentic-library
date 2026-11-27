import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const scratch = mkdtempSync(join(tmpdir(), 'repository-test-'))

async function storeOver(dir: string) {
  vi.stubEnv('CONTENT_DIR', dir)
  vi.resetModules()
  return import('~/server/repository')
}

afterAll(() => {
  vi.resetModules()
  rmSync(scratch, { recursive: true, force: true })
})

describe.each([
  ['a content folder that does not exist', () => join(scratch, 'missing')],
  [
    'a content folder with no catalog/',
    () => {
      const dir = join(scratch, 'no-catalog')
      mkdirSync(join(dir, 'books'), { recursive: true })
      return dir
    },
  ],
])('%s', (_name, folder) => {
  it('gives an empty catalogue, and nothing for a slug', async () => {
    const store = await storeOver(folder())
    expect(await store.loadCatalog()).toEqual({ collections: [], series: [], books: [] })
    expect(await store.catalogueBook('pride-and-prejudice')).toBeUndefined()
    expect(await store.loadBook('pride-and-prejudice')).toBeNull()
    expect(await store.loadAudio('pride-and-prejudice')).toBeNull()
    expect(await store.coverFile('pride-and-prejudice')).toBeNull()
  })
})

it('still fails on a catalog/ it cannot read', async () => {
  const dir = join(scratch, 'unreadable')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'catalog'), 'a file, not a folder')
  const store = await storeOver(dir)
  await expect(store.loadCatalog()).rejects.toMatchObject({ code: 'ENOTDIR' })
})
