import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isMp3Frame, sniffAudio } from './sniff'

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

const ftyp = (major: string, ...compatible: string[]) =>
  bytes(u32(16 + 4 * compatible.length), 'ftyp', major, u32(0), ...compatible, new Array(16).fill(0))

const FRAME = [0xff, 0xfb, 0x90, 0x64]

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/audio/${name}`))

describe('sniffAudio', () => {
  it('takes the fixtures for what they are', () => {
    expect(sniffAudio(fixture('chapter-1.mp3'))).toBe('mp3')
    expect(sniffAudio(fixture('three-chapters.m4b'))).toBe('mp4')
  })

  it('reads an MP3 with an ID3 tag, or a bare frame sync', () => {
    const tag = bytes('ID3', [3, 0, 0], [0, 0, 0, 4], [0, 0, 0, 0], FRAME, new Array(8).fill(0))
    expect(sniffAudio(tag)).toBe('mp3')
    expect(sniffAudio(bytes(FRAME, new Array(12).fill(0)))).toBe('mp3')
    expect(sniffAudio(bytes('ID3', [3, 0, 0], [0, 0, 0, 2], [0, 0], FRAME, new Array(8).fill(0)))).toBe('mp3')
  })

  it('trusts an ID3 tag longer than the bytes it was given', () => {
    expect(sniffAudio(bytes('ID3', [3, 0, 0], [0, 4, 0, 0], new Array(20).fill(0)))).toBe('mp3')
  })

  it('tells MP4 brands apart: M4B and isom are audiobooks, M4A is music, M4P and aax are protected', () => {
    expect(sniffAudio(ftyp('M4B ', 'M4B ', 'mp42'))).toBe('mp4')
    expect(sniffAudio(ftyp('isom', 'iso2'))).toBe('mp4')
    expect(sniffAudio(ftyp('M4A ', 'M4A '))).toEqual({ other: 'M4A' })
    expect(sniffAudio(ftyp('M4P '))).toBe('m4a-drm')
    expect(sniffAudio(ftyp('aax '))).toBe('aax')
    expect(sniffAudio(ftyp('isom', 'aax '))).toBe('aax')
  })

  it('names Ogg, Opus and FLAC, even behind an ID3 tag', () => {
    const page = (codec: string) => bytes('OggS', new Array(24).fill(0), codec, new Array(8).fill(0))
    expect(sniffAudio(page('vorbis\0\0'))).toEqual({ other: 'Ogg' })
    expect(sniffAudio(page('OpusHead'))).toEqual({ other: 'Opus' })
    expect(sniffAudio(bytes('fLaC', new Array(12).fill(0)))).toEqual({ other: 'FLAC' })
    expect(sniffAudio(bytes('ID3', [3, 0, 0], [0, 0, 0, 0], 'fLaC', new Array(12).fill(0)))).toEqual({ other: 'FLAC' })
  })

  it('calls random bytes and short files not audio', () => {
    expect(sniffAudio(bytes('%PDF-1.7 hello world'))).toEqual({ other: null })
    expect(sniffAudio(bytes(FRAME))).toEqual({ other: null })
    expect(sniffAudio(new Uint8Array(0))).toEqual({ other: null })
  })
})

describe('isMp3Frame', () => {
  it('wants Layer III, a known version, bitrate and sample rate', () => {
    expect(isMp3Frame(new Uint8Array(FRAME), 0)).toBe(true)
    expect(isMp3Frame(new Uint8Array([0xff, 0xfd, 0x90, 0x64]), 0)).toBe(false)
    expect(isMp3Frame(new Uint8Array([0xff, 0xeb, 0x90, 0x64]), 0)).toBe(false)
    expect(isMp3Frame(new Uint8Array([0xff, 0xfb, 0xf0, 0x64]), 0)).toBe(false)
    expect(isMp3Frame(new Uint8Array([0xff, 0xfb, 0x9c, 0x64]), 0)).toBe(false)
    expect(isMp3Frame(new Uint8Array([0xff, 0xfb, 0x90]), 0)).toBe(false)
  })
})
