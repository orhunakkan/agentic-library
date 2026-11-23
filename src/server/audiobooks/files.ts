import '@tanstack/react-start/server-only'
import { constants } from 'node:fs'
import { access, mkdir, open, readdir, rm, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { AUDIO_EXTENSION, type AudioFileType } from '../../shared/audiobooks/limits.ts'
import { isUuid } from '../../shared/uuid.ts'
import { getConfig } from '../config.ts'
import { logError } from '../redact.ts'

let checked: { dir: string; ok: Promise<boolean> } | null = null

export async function audiobooksDir(): Promise<string | null> {
  const dir = getConfig().audiobooksDir
  if (!dir) return null
  if (checked?.dir !== dir) {
    const ok = access(dir, constants.W_OK | constants.R_OK | constants.X_OK).then(
      async () => (await stat(dir)).isDirectory(),
      () => false,
    )
    checked = {
      dir,
      ok: ok.then((usable) => {
        if (!usable)
          logError('audiobooks', new Error('AUDIOBOOKS_DIR is missing or not writable; audiobook import is off'))
        return usable
      }),
    }
  }
  return (await checked.ok) ? dir : null
}

export const audiobooksOn = async () => (await audiobooksDir()) !== null

const userDir = (root: string, userId: number) => {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('bad user id')
  return join(root, String(userId))
}

export function bookDir(root: string, userId: number, bookId: string): string {
  if (!isUuid(bookId)) throw new Error('bad book id')
  return join(userDir(root, userId), bookId)
}

export function audioPath(root: string, userId: number, bookId: string, n: number, type: AudioFileType): string {
  if (!Number.isInteger(n) || n < 1) throw new Error('bad file number')
  return join(bookDir(root, userId, bookId), `${n}.${AUDIO_EXTENSION[type]}`)
}

export async function makeBookDir(root: string, userId: number, bookId: string): Promise<void> {
  await mkdir(bookDir(root, userId, bookId), { recursive: true, mode: 0o700 })
}

export async function appendAt(path: string, offset: number, bytes: Uint8Array): Promise<'ok' | { size: number }> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT, 0o600)
  try {
    const { size } = await file.stat()
    if (size < offset) return { size }
    if (size > offset) await file.truncate(offset)
    let written = 0
    while (written < bytes.length) {
      const { bytesWritten } = await file.write(bytes, written, bytes.length - written, offset + written)
      written += bytesWritten
    }
    return 'ok'
  } finally {
    await file.close()
  }
}

export async function freeBytes(root: string): Promise<number> {
  const info = await statfs(root)
  return info.bavail * info.bsize
}

export async function removeBook(root: string, userId: number, bookId: string): Promise<void> {
  await rm(bookDir(root, userId, bookId), { recursive: true, force: true })
}

export async function removeUser(root: string, userId: number): Promise<void> {
  await rm(userDir(root, userId), { recursive: true, force: true })
}

export async function sweep(root: string, userId: number, liveIds: ReadonlySet<string>): Promise<number> {
  const names = await readdir(userDir(root, userId)).catch(() => [] as string[])
  const stray = names.filter((name) => isUuid(name) && !liveIds.has(name))
  await Promise.all(stray.map((id) => removeBook(root, userId, id)))
  return stray.length
}

export async function forgetUserAudio(userId: number): Promise<void> {
  try {
    const root = await audiobooksDir()
    if (root) await removeUser(root, userId)
  } catch (error) {
    logError('audiobooks remove user', error)
  }
}

export async function forgetBookAudio(userId: number, bookId: string): Promise<void> {
  try {
    const root = await audiobooksDir()
    if (root) await removeBook(root, userId, bookId)
  } catch (error) {
    logError('audiobooks remove book', error)
  }
}
