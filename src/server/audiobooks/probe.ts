import '@tanstack/react-start/server-only'
import { open } from 'node:fs/promises'
import { parseFile } from 'music-metadata'
import { mp4Audio, type ReadRange } from '../../shared/audiobooks/drm.ts'
import { type AudioFileType, MAX_FILE_MS, MIN_FILE_MS, SNIFF_BYTES } from '../../shared/audiobooks/limits.ts'
import { sniffAudio } from '../../shared/audiobooks/sniff.ts'
import { redact } from '../redact.ts'

export type Probe =
  | { ok: true; durationMs: number }
  | { ok: false; problem: 'drm' }
  | { ok: false; problem: 'unreadable'; reason: string }

const unreadable = (reason: string): Probe => ({ ok: false, problem: 'unreadable', reason })

export async function probeFile(path: string, type: AudioFileType): Promise<Probe> {
  let soundless = false
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    const read: ReadRange = async (start, end) => {
      const length = Math.max(0, Math.min(end, size) - start)
      const buffer = new Uint8Array(length)
      const { bytesRead } = await file.read(buffer, 0, length, start)
      return buffer.subarray(0, bytesRead)
    }
    const sniffed = sniffAudio(await read(0, SNIFF_BYTES))
    if (sniffed === 'aax' || sniffed === 'm4a-drm') return { ok: false, problem: 'drm' }
    if (sniffed !== type) return unreadable(type === 'mp4' ? 'it isn’t an M4B file' : 'it isn’t an MP3 file')
    if (type === 'mp4') {
      const kind = await mp4Audio(read, size)
      if (kind === 'drm') return { ok: false, problem: 'drm' }
      if (kind === 'other') return unreadable('its sound isn’t AAC')
      soundless = kind === 'none'
    }
  } finally {
    await file.close()
  }

  let seconds: number | undefined
  let codec: string | undefined
  try {
    const { format } = await parseFile(path, { duration: true, skipCovers: true })
    seconds = format.duration
    codec = format.codec
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return unreadable(redact(message).replace(/\s+/g, ' ').trim().slice(0, 200) || 'it couldn’t be read')
  }
  if (soundless) return unreadable('it has no sound track')
  if (type === 'mp3' && !/layer 3/i.test(codec ?? '')) return unreadable('its sound isn’t MP3')
  const ms = Math.round((seconds ?? 0) * 1000)
  if (!Number.isFinite(ms) || ms < MIN_FILE_MS) return unreadable('it’s shorter than a second')
  if (ms > MAX_FILE_MS) return unreadable('it’s longer than 48 hours')
  return { ok: true, durationMs: ms }
}
