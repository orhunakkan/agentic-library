import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { probeFile } from './probe'

const dir = mkdtempSync(join(tmpdir(), 'probe-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const fixture = (name: string) => {
  const path = join(dir, name)
  copyFileSync(new URL(`../../../tests/fixtures/audio/${name}`, import.meta.url), path)
  return path
}

const text = (s: string) => [...s].map((c) => c.charCodeAt(0))
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const box = (type: string, ...body: number[][]) => {
  const content = body.flat()
  return [...u32(8 + content.length), ...text(type), ...content]
}
function mp4(handler: string, format: string): string {
  const stsd = box('stsd', [0, 0, 0, 0], u32(1), box(format, new Array(28).fill(0)))
  const trak = box(
    'trak',
    box(
      'mdia',
      box('hdlr', new Array(8).fill(0), text(handler), new Array(12).fill(0)),
      box('minf', box('stbl', stsd)),
    ),
  )
  const path = join(dir, `${handler}-${format}.m4b`)
  writeFileSync(
    path,
    new Uint8Array([...box('ftyp', text('M4B '), u32(0)), ...box('moov', trak), ...box('mdat', new Array(32).fill(0))]),
  )
  return path
}

describe('probeFile', () => {
  it('reads a clean M4B and MP3, with their lengths', async () => {
    expect(await probeFile(fixture('three-chapters.m4b'), 'mp4')).toEqual({ ok: true, durationMs: 9046 })
    expect(await probeFile(fixture('chapter-1.mp3'), 'mp3')).toEqual({ ok: true, durationMs: 10057 })
  })

  it('calls protected files DRM, by their sample entry or their brand', async () => {
    expect(await probeFile(fixture('drm.m4b'), 'mp4')).toEqual({ ok: false, problem: 'drm' })
    const aax = join(dir, 'book.aax')
    writeFileSync(aax, new Uint8Array(box('ftyp', text('aax '), u32(0), new Array(8).fill(0))))
    expect(await probeFile(aax, 'mp4')).toEqual({ ok: false, problem: 'drm' })
  })

  it('says why it can’t read the rest', async () => {
    const truncated = await probeFile(fixture('truncated.m4b'), 'mp4')
    expect(truncated).toMatchObject({ ok: false, problem: 'unreadable' })
    expect(await probeFile(fixture('chapter-2.mp3'), 'mp4')).toEqual({
      ok: false,
      problem: 'unreadable',
      reason: 'it isn’t an M4B file',
    })
    expect(await probeFile(mp4('soun', 'alac'), 'mp4')).toEqual({
      ok: false,
      problem: 'unreadable',
      reason: 'its sound isn’t AAC',
    })
    expect(await probeFile(mp4('vide', 'avc1'), 'mp4')).toMatchObject({ ok: false, problem: 'unreadable' })
  })
})
