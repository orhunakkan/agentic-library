import { KB, MB } from '../import/limits.ts'

export const GB = 1024 * MB

export const MAX_AUDIOBOOK_BYTES = 2 * GB
export const MAX_AUDIO_FILES = 500
export const MAX_AUDIO_CHAPTERS = 1000
export const MAX_USER_AUDIO_BYTES = 8 * GB
export const MAX_CHAPTER_MS = 24 * 60 * 60 * 1000
export const MAX_FILE_MS = 48 * 60 * 60 * 1000
export const MIN_FILE_MS = 1000
export const PART_MS = 60 * 60 * 1000
export const MIN_FREE_BYTES = 10 * GB
export const MIN_FREE_BYTES_UPLOADING = 5 * GB

export const CHUNK_BYTES = 896 * KB
export const MAX_START_REQUEST_BYTES = 512 * KB
export const PARALLEL_FILES = 3
export const SNIFF_BYTES = 64 * KB
export const NARRATOR_MAX = 200

export type AudioFileType = 'mp4' | 'mp3'
export const AUDIO_MEDIA_TYPE: Record<AudioFileType, 'audio/mp4' | 'audio/mpeg'> = {
  mp4: 'audio/mp4',
  mp3: 'audio/mpeg',
}
export const AUDIO_EXTENSION: Record<AudioFileType, 'm4b' | 'mp3'> = { mp4: 'm4b', mp3: 'mp3' }
