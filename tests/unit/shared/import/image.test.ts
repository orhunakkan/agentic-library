import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  checkBookImage,
  checkCoverImage,
  fitWithin,
  isSvg,
  outputTypeFor,
  pageWeight,
  shortHash,
  sniffImage,
  svgSize,
} from '~/shared/import/image'
import { MAX_COVER_BYTES, MAX_IMAGE_BYTES } from '~/shared/import/limits'

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))
const be16 = (n: number) => [n >> 8, n & 0xff]
const be32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const le16 = (n: number) => [n & 0xff, n >> 8]
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, n >> 16]

const pngHeader = (w: number, h: number) =>
  bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(w), be32(h), [8, 2, 0, 0, 0])

const jpegHeader = (w: number, h: number, sof = 0xc0, before: number[][] = []) =>
  bytes([0xff, 0xd8], ...before, [0xff, sof], be16(17), [8], be16(h), be16(w), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])

const segment = (marker: number, payload: number[]) => [0xff, marker, ...be16(payload.length + 2), ...payload]

const riff = (chunk: string, body: number[]) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', chunk, [0, 0, 0, 0], body)

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../fixtures/images/${name}`, import.meta.url)))

describe('sniffImage', () => {
  it('reads a PNG’s size from its IHDR chunk', () => {
    expect(sniffImage(pngHeader(600, 900))).toEqual({ type: 'image/png', width: 600, height: 900 })
  })

  it('reads a baseline and a progressive JPEG', () => {
    expect(sniffImage(jpegHeader(400, 600))).toEqual({ type: 'image/jpeg', width: 400, height: 600 })
    expect(sniffImage(jpegHeader(401, 602, 0xc2))).toEqual({ type: 'image/jpeg', width: 401, height: 602 })
  })

  it('walks past APPn, DQT and DHT segments to the frame, and ignores fill bytes', () => {
    const exif = segment(0xe1, [...bytes('Exif'), 0, 0, ...Array(40).fill(7)])
    const dqt = segment(0xdb, Array(65).fill(1))
    const dht = segment(0xc4, Array(30).fill(2))
    expect(sniffImage(jpegHeader(320, 480, 0xc0, [exif, dqt, [0xff], dht]))).toEqual({
      type: 'image/jpeg',
      width: 320,
      height: 480,
    })
  })

  it('reads the three kinds of WebP and a GIF', () => {
    const vp8 = [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(640), ...le16(960)]
    expect(sniffImage(riff('VP8 ', vp8))).toEqual({ type: 'image/webp', width: 640, height: 960 })
    const bits = (640 - 1) | ((960 - 1) << 14)
    const vp8l = [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff, 0]
    expect(sniffImage(riff('VP8L', [...vp8l, 0, 0, 0, 0]))).toEqual({ type: 'image/webp', width: 640, height: 960 })
    expect(sniffImage(riff('VP8X', [0, 0, 0, 0, ...le24(639), ...le24(959)]))).toEqual({
      type: 'image/webp',
      width: 640,
      height: 960,
    })
    expect(sniffImage(bytes('GIF89a', le16(100), le16(150), [0]))).toEqual({
      type: 'image/gif',
      width: 100,
      height: 150,
    })
    expect(sniffImage(bytes('GIF87a', le16(1), le16(1)))).toEqual({ type: 'image/gif', width: 1, height: 1 })
  })

  it('gives null for an SVG, a header cut short, a length past the end and random bytes', () => {
    expect(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'))).toBeNull()
    expect(sniffImage(pngHeader(600, 900).slice(0, 20))).toBeNull()
    expect(sniffImage(jpegHeader(400, 600).slice(0, 10))).toBeNull()
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0], be16(500), [1, 2, 3]))).toBeNull()
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xda], be16(4), [0, 0]))).toBeNull()
    expect(sniffImage(bytes([0xff, 0xd8, 0x00]))).toBeNull()
    expect(sniffImage(riff('VP8 ', [0, 0, 0, 1, 2, 3, 0, 0, 0, 0]))).toBeNull()
    expect(sniffImage(riff('VP9 ', Array(10).fill(0)))).toBeNull()
    expect(sniffImage(pngHeader(0, 900))).toBeNull()
    expect(sniffImage(new Uint8Array(64).map((_, i) => (i * 37) % 251))).toBeNull()
    expect(sniffImage(new Uint8Array())).toBeNull()
  })

  it('agrees with the generated fixture images', () => {
    expect(sniffImage(fixture('cover.jpg'))).toEqual({ type: 'image/jpeg', width: 400, height: 600 })
    expect(sniffImage(fixture('wide.png'))).toEqual({ type: 'image/png', width: 900, height: 600 })
    expect(sniffImage(fixture('tiny.png'))).toEqual({ type: 'image/png', width: 40, height: 60 })
    expect(sniffImage(fixture('not-an-image.jpg'))).toBeNull()
  })
})

describe('checkCoverImage', () => {
  it('takes a JPEG or a PNG within the limits', () => {
    expect(checkCoverImage(jpegHeader(600, 900))).toEqual({
      ok: true,
      info: { type: 'image/jpeg', width: 600, height: 900 },
    })
    expect(checkCoverImage(pngHeader(64, 64)).ok).toBe(true)
    expect(checkCoverImage(pngHeader(2400, 3600)).ok).toBe(true)
  })

  it('refuses WebP, GIF and anything unknown as the wrong type', () => {
    expect(checkCoverImage(riff('VP8X', [0, 0, 0, 0, ...le24(599), ...le24(899)]))).toEqual({
      ok: false,
      problem: 'type',
    })
    expect(checkCoverImage(bytes('GIF89a', le16(600), le16(900)))).toEqual({ ok: false, problem: 'type' })
    expect(checkCoverImage(fixture('not-an-image.jpg'))).toEqual({ ok: false, problem: 'type' })
  })

  it('refuses a cover under 64 pixels as small, and one over the size or byte limit as large', () => {
    expect(checkCoverImage(pngHeader(63, 900))).toEqual({ ok: false, problem: 'small' })
    expect(checkCoverImage(pngHeader(600, 63))).toEqual({ ok: false, problem: 'small' })
    expect(checkCoverImage(pngHeader(2401, 900))).toEqual({ ok: false, problem: 'large' })
    expect(checkCoverImage(pngHeader(600, 3601))).toEqual({ ok: false, problem: 'large' })
    const big = new Uint8Array(MAX_COVER_BYTES + 1)
    big.set(jpegHeader(600, 900))
    expect(checkCoverImage(big)).toEqual({ ok: false, problem: 'large' })
    expect(checkCoverImage(big.slice(0, MAX_COVER_BYTES)).ok).toBe(true)
  })
})

describe('fitWithin', () => {
  it('keeps the aspect and never enlarges', () => {
    expect(fitWithin(1200, 1800, 600, 900)).toEqual({ width: 600, height: 900 })
    expect(fitWithin(300, 450, 600, 900)).toEqual({ width: 300, height: 450 })
  })

  it('fits a tall and a wide image by their longer side', () => {
    expect(fitWithin(1000, 3000, 600, 900)).toEqual({ width: 300, height: 900 })
    expect(fitWithin(2000, 1000, 600, 900)).toEqual({ width: 600, height: 300 })
  })
})

describe('shortHash', () => {
  it('is the first 8 hex digits', () => {
    expect(shortHash('0123456789abcdef')).toBe('01234567')
  })
})

describe('checkBookImage', () => {
  const png = (w: number, h: number, size = 100) => {
    const header = pngHeader(w, h)
    const out = new Uint8Array(Math.max(size, header.length))
    out.set(header)
    return out
  }

  it('takes JPEG and PNG at the edges of the box', () => {
    expect(checkBookImage(png(16, 16))).toEqual({ ok: true, info: { type: 'image/png', width: 16, height: 16 } })
    expect(checkBookImage(png(1600, 4800))).toMatchObject({ ok: true })
    expect(checkBookImage(jpegHeader(1600, 900))).toMatchObject({ ok: true, info: { type: 'image/jpeg' } })
    expect(checkBookImage(png(100, 100, MAX_IMAGE_BYTES))).toMatchObject({ ok: true })
  })

  it.each([
    ['15 px wide', png(15, 100), 'small'],
    ['15 px tall', png(100, 15), 'small'],
    ['1,601 wide', png(1601, 100), 'large'],
    ['4,801 tall', png(100, 4801), 'large'],
    ['a byte over 900 KB', png(100, 100, MAX_IMAGE_BYTES + 1), 'large'],
    ['a GIF', bytes('GIF89a', le16(100), le16(100)), 'type'],
    ['a WebP', riff('VP8X', [0, 0, 0, 0, ...le24(99), ...le24(99)]), 'type'],
    ['not an image', bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'type'],
  ])('refuses %s', (_, image, problem) => {
    expect(checkBookImage(image)).toEqual({ ok: false, problem })
  })
})

describe('outputTypeFor', () => {
  it('keeps line art as PNG and photos as JPEG', () => {
    expect(outputTypeFor('image/png')).toBe('image/png')
    expect(outputTypeFor('image/gif')).toBe('image/png')
    expect(outputTypeFor('image/svg+xml')).toBe('image/png')
    expect(outputTypeFor('image/jpeg')).toBe('image/jpeg')
    expect(outputTypeFor('image/webp')).toBe('image/jpeg')
  })
})

describe('isSvg and svgSize', () => {
  const svg = (text: string) => new TextEncoder().encode(text)

  it('knows an SVG by its root element, after a declaration, comments or a doctype', () => {
    expect(isSvg(svg('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(true)
    expect(isSvg(svg('﻿<?xml version="1.0"?>\n<!-- drawn by hand -->\n<!DOCTYPE svg>\n<svg viewBox="0 0 1 1"/>'))).toBe(
      true,
    )
    expect(isSvg(svg('<html><svg></svg></html>'))).toBe(false)
    expect(isSvg(svg('<svgx/>'))).toBe(false)
    expect(isSvg(pngHeader(10, 10))).toBe(false)
  })

  it('reads the size from width and height, else the viewBox', () => {
    expect(svgSize('<svg width="320" height="200px"/>')).toEqual({ width: 320, height: 200 })
    expect(svgSize("<svg viewBox='0 0 640 480'/>")).toEqual({ width: 640, height: 480 })
    expect(svgSize('<svg viewBox="0,0,640,480" width="320"/>')).toEqual({ width: 320, height: 240 })
    expect(svgSize('<svg viewBox="0 0 640 480" height="240"/>')).toEqual({ width: 320, height: 240 })
    expect(svgSize('<svg width="100%" height="100%" viewBox="0 0 50 25"/>')).toEqual({ width: 50, height: 25 })
  })

  it('has no size when it names none', () => {
    expect(svgSize('<svg/>')).toBeNull()
    expect(svgSize('<svg width="10em" height="5em"/>')).toBeNull()
    expect(svgSize('<svg viewBox="0 0 0 10"/>')).toBeNull()
    expect(svgSize('<p>not svg</p>')).toBeNull()
  })
})

describe('pageWeight', () => {
  it('weighs a picture as the prose its shown height replaces, between 40 and 400 words', () => {
    expect(pageWeight(120, 60)).toBe(40)
    expect(pageWeight(600, 330)).toBe(104)
    expect(pageWeight(1320, 600)).toBe(pageWeight(660, 300))
    expect(pageWeight(400, 4000)).toBe(176)
  })
})
