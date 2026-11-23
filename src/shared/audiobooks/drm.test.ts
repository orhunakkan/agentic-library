import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mp4Audio, readBytes } from './drm'

const text = (s: string) => [...s].map((c) => c.charCodeAt(0))
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

const box = (type: string, ...body: number[][]) => {
  const content = body.flat()
  return [...u32(8 + content.length), ...text(type), ...content]
}

const entry = (format: string, ...inside: number[][]) => box(format, new Array(28).fill(0), ...inside)

const trak = (handler: string, ...entries: number[][]) =>
  box(
    'trak',
    box('tkhd', new Array(20).fill(0)),
    box(
      'mdia',
      box('hdlr', [0, 0, 0, 0], [0, 0, 0, 0], text(handler), new Array(12).fill(0)),
      box('minf', box('stbl', box('stsd', [0, 0, 0, 0], u32(entries.length), ...entries), box('stsz', u32(0)))),
    ),
  )

const file = (...top: number[][]) => new Uint8Array(top.flat())
const ftyp = box('ftyp', text('M4B '), u32(0))
const mdat = box('mdat', new Array(64).fill(7))

const check = (bytes: Uint8Array) => mp4Audio(readBytes(bytes), bytes.length)

describe('mp4Audio', () => {
  it('finds an unprotected AAC track, with moov first or last', async () => {
    const moov = box('moov', trak('soun', entry('mp4a', box('esds', [0, 0, 0, 0]))))
    expect(await check(file(ftyp, moov, mdat))).toBe('aac')
    expect(await check(file(ftyp, mdat, moov))).toBe('aac')
  })

  it('calls drms, enca and aavd entries, and a sinf box, copy-protected', async () => {
    for (const format of ['drms', 'enca', 'aavd'])
      expect(await check(file(ftyp, mdat, box('moov', trak('soun', entry(format)))))).toBe('drm')
    const sinf = entry('mp4a', box('sinf', box('frma', text('mp4a'))))
    expect(await check(file(ftyp, box('moov', trak('soun', sinf))))).toBe('drm')
  })

  it('looks only at sound tracks, and names other codecs', async () => {
    const moov = box('moov', trak('text', entry('text')), trak('soun', entry('mp4a')))
    expect(await check(file(ftyp, moov))).toBe('aac')
    expect(await check(file(ftyp, box('moov', trak('soun', entry('alac')))))).toBe('other')
    expect(await check(file(ftyp, box('moov', trak('vide', entry('avc1')))))).toBe('none')
    expect(await check(file(ftyp, mdat))).toBe('none')
  })

  it('reads 64-bit box sizes, and a last box that runs to the end', async () => {
    const big = [...u32(1), ...text('mdat'), ...u32(0), ...u32(24), ...new Array(8).fill(0)]
    const moov = box('moov', trak('soun', entry('mp4a')))
    expect(await check(file(ftyp, big, moov))).toBe('aac')
    const toEnd = [...u32(0), ...text('moov'), ...trak('soun', entry('drms'))]
    expect(await check(file(ftyp, toEnd))).toBe('drm')
  })

  it('stops at a box that doesn’t fit, and at a reader that fails', async () => {
    const broken = file(ftyp, [...u32(4000), ...text('moov'), ...trak('soun', entry('mp4a'))])
    expect(await check(broken)).toBe('none')
    expect(await mp4Audio(() => Promise.reject(new Error('gone')), 100)).toBe('none')
  })

  it('reads the fixtures: the M4B is AAC and its patched copy is DRM', async () => {
    const read = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/audio/${name}`))
    expect(await check(read('three-chapters.m4b'))).toBe('aac')
    expect(await check(read('drm.m4b'))).toBe('drm')
  })
})
