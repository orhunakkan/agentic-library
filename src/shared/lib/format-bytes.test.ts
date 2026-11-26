import { describe, expect, it } from 'vitest'
import { formatBytes } from './format-bytes.ts'

const KiB = 1024
const MiB = 1024 * KiB
const GiB = 1024 * MiB

describe('formatBytes', () => {
  it('names a limit in the largest unit that keeps it at 1 or more, without a trailing .0', () => {
    expect(formatBytes(GiB)).toBe('1 GB')
    expect(formatBytes(8 * GiB)).toBe('8 GB')
    expect(formatBytes(100 * MiB)).toBe('100 MB')
    expect(formatBytes(1.5 * GiB)).toBe('1.5 GB')
    expect(formatBytes(512 * KiB)).toBe('512 KB')
    expect(formatBytes(412 * MiB)).toBe('412 MB')
  })

  it('shows MB and GB with one decimal', () => {
    expect(formatBytes(2.4 * MiB)).toBe('2.4 MB')
    expect(formatBytes(2.44 * GiB)).toBe('2.4 GB')
  })

  it('rounds KB to a whole number, and shows anything from 1 byte up as at least 1 KB', () => {
    expect(formatBytes(1)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('2 KB')
    expect(formatBytes(1023 * KiB)).toBe('1023 KB')
  })

  it('moves up a unit when rounding reaches the next one', () => {
    expect(formatBytes(MiB - 1)).toBe('1 MB')
    expect(formatBytes(GiB - 1)).toBe('1 GB')
  })

  it('says 0 KB for nothing', () => {
    expect(formatBytes(0)).toBe('0 KB')
  })
})
