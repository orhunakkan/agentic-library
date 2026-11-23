import { describe, expect, it } from 'vitest'
import { makeZip } from '../../../tests/fixtures/zip'
import { openZip, readZip } from './zip'

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes)

describe('readZip', () => {
  it('reads stored and deflated entries, and leaves out directories', async () => {
    const zip = makeZip([
      { name: 'stored.txt', data: 'kept as is', store: true },
      { name: 'dir/deflated.txt', data: 'squeezed '.repeat(1000) },
      { name: 'dir/', data: '', store: true },
      { name: 'ünïcode.md', data: '名前' },
    ])
    const files = await readZip(zip)
    expect([...files.keys()]).toEqual(['stored.txt', 'dir/deflated.txt', 'ünïcode.md'])
    expect(text(files.get('stored.txt'))).toBe('kept as is')
    expect(text(files.get('dir/deflated.txt'))).toBe('squeezed '.repeat(1000))
    expect(text(files.get('ünïcode.md'))).toBe('名前')
  })

  it('works on a view into a larger buffer', async () => {
    const zip = makeZip([{ name: 'a.txt', data: 'offset' }])
    const padded = new Uint8Array(zip.length + 10)
    padded.set(zip, 5)
    expect(text((await readZip(padded.subarray(5, 5 + zip.length))).get('a.txt'))).toBe('offset')
  })

  it('inflates nothing until an entry is read', () => {
    const entries = openZip(makeZip([{ name: 'a.txt', data: 'x'.repeat(5000) }]))
    expect(entries.get('a.txt')?.size).toBe(5000)
  })
})

describe('the bomb guard', () => {
  it('refuses an archive whose declared sizes add up past the limit', () => {
    const zip = makeZip([
      { name: 'a', data: '0'.repeat(600) },
      { name: 'b', data: '0'.repeat(600) },
    ])
    expect(() => openZip(zip, { maxTotalBytes: 1000 })).toThrow(/too large once uncompressed/)
    expect(() => openZip(zip, { maxTotalBytes: 1200 })).not.toThrow()
  })

  it('stops an entry that inflates past the size it declares', async () => {
    const zip = makeZip([{ name: 'bomb', data: '0'.repeat(100_000) }])
    const view = new DataView(zip.buffer)
    const directory = view.getUint32(zip.length - 22 + 16, true)
    view.setUint32(directory + 24, 100, true)
    await expect(openZip(zip).get('bomb')?.read()).rejects.toThrow(/more than its declared size/)
  })

  it('refuses an entry that comes out shorter than declared', async () => {
    const zip = makeZip([{ name: 'short', data: 'abc' }])
    const view = new DataView(zip.buffer)
    view.setUint32(view.getUint32(zip.length - 22 + 16, true) + 24, 10, true)
    await expect(openZip(zip).get('short')?.read()).rejects.toThrow(/less than its declared size/)
  })
})

describe('damaged archives', () => {
  const zip = makeZip([
    { name: 'one.txt', data: 'first file '.repeat(50) },
    { name: 'two.txt', data: 'second file '.repeat(50) },
  ])

  it('refuses something that is not a ZIP', () => {
    expect(() => openZip(new TextEncoder().encode('just some text, no archive here'))).toThrow(/not a ZIP file/)
    expect(() => openZip(new Uint8Array(3))).toThrow(/not a ZIP file/)
  })

  it('refuses an archive cut short', () => {
    const end = zip.subarray(zip.length - 22)
    const cut = new Uint8Array([...zip.subarray(0, 40), ...end])
    expect(() => openZip(cut)).toThrow(/truncated|bad ZIP/)
    expect(() => openZip(zip.subarray(0, zip.length - 30))).toThrow()
  })

  it('refuses a corrupt deflate stream', async () => {
    const broken = new Uint8Array(zip)
    const dataAt = 30 + 'one.txt'.length
    broken.fill(0xff, dataAt, dataAt + 8)
    await expect(openZip(broken).get('one.txt')?.read()).rejects.toThrow(/damaged|declared size/)
  })
})
