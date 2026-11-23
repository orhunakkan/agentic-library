import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { voicesDirOf } from '../../src/server/config.ts'
import {
  FOLIO_VOICES,
  type FolioVoiceFile,
  filesOfVoice,
  PIPER_VOICES_COMMIT,
  voiceFileName,
} from '../../src/shared/read-aloud/folio-voices.ts'

const BASE = `https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICES_COMMIT}/`

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function isValid(path: string, file: FolioVoiceFile): Promise<boolean> {
  const info = await stat(path).catch(() => null)
  return info?.size === file.bytes && (await sha256Of(path)) === file.sha256
}

const TRIES = 3
const RETRY_MS = 3000

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

class HashMismatch extends Error {}

async function fetchFile(dir: string, file: FolioVoiceFile, id: string): Promise<'kept' | 'fetched'> {
  const path = join(dir, voiceFileName(file, id))
  if (await isValid(path, file)) return 'kept'
  for (let attempt = 1; ; attempt++) {
    try {
      await download(path, file, id)
      return 'fetched'
    } catch (error) {
      if (error instanceof HashMismatch || attempt >= TRIES) throw error
      const why = error instanceof Error ? error.message : String(error)
      console.log(`retry   ${voiceFileName(file, id)} (${why})`)
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
    }
  }
}

async function download(path: string, file: FolioVoiceFile, id: string): Promise<void> {
  const name = voiceFileName(file, id)
  const part = `${path}.part`
  const response = await fetch(`${BASE}${file.path}`, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`${name}: Hugging Face answered ${response.status}`)
  const hash = createHash('sha256')
  const hashing = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk)
      done(null, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(response.body as never), hashing, createWriteStream(part))
    const sha256 = hash.digest('hex')
    if (sha256 !== file.sha256)
      throw new HashMismatch(`${name}: the SHA-256 is ${sha256}, not the catalogue's ${file.sha256}`)
    await rename(part, path)
  } finally {
    await rm(part, { force: true })
  }
}

export async function fetchVoices(ids: string[], dir: string): Promise<void> {
  const unknown = ids.filter((id) => !FOLIO_VOICES.some((v) => v.id === id))
  if (unknown.length) throw new Error(`Not in the catalogue: ${unknown.join(', ')}`)
  const voices = ids.length ? FOLIO_VOICES.filter((v) => ids.includes(v.id)) : FOLIO_VOICES
  await mkdir(dir, { recursive: true })
  for (const voice of voices) {
    for (const file of filesOfVoice(voice)) {
      const outcome = await fetchFile(dir, file, voice.id)
      console.log(`${outcome === 'kept' ? 'kept   ' : 'fetched'} ${voiceFileName(file, voice.id)} (${mb(file.bytes)})`)
    }
  }
}

if (import.meta.main) {
  const dir = voicesDirOf(process.env)
  try {
    await fetchVoices(process.argv.slice(2), dir)
    console.log(`voices:fetch: done, in ${dir}`)
  } catch (error) {
    console.error(`voices:fetch: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
