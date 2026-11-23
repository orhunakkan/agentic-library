import { describe, expect, it, vi } from 'vitest'

const { load } = vi.hoisted(() => ({ load: vi.fn(() => Promise.reject(new Error('no grammar'))) }))
vi.mock('shiki/langs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('shiki/langs')>()
  return { ...actual, bundledLanguages: { ...actual.bundledLanguages, typescript: load } }
})

import { highlight } from './highlight.ts'

describe('a grammar that fails to load', () => {
  it('leaves the file plain, and isn’t asked for again', async () => {
    expect((await highlight('const a = 1', 'typescript')).highlighted).toBe(false)
    expect((await highlight('const b = 2', 'typescript')).highlighted).toBe(false)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
