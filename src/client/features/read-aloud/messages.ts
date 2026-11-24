import { proNotice } from '~/shared/plans/copy'
import { aboutMegabytes, megabytes } from '~/shared/read-aloud/folio-voices'
import type { Problem } from './controller'
import type { CloudProblemCode, LocalProblemCode } from './speaker'

const CLOUD_TEXT: Record<Exclude<CloudProblemCode, 'rate'>, string> = {
  key_rejected: 'ElevenLabs rejected your key. Check it on the API keys page.',
  no_credits: 'Your ElevenLabs account is out of credits.',
  permission: 'Your ElevenLabs key isn’t allowed to make speech. Allow it Text to Speech in ElevenLabs.',
  voice_gone: 'This ElevenLabs voice is no longer available. Pick another voice.',
  busy: 'ElevenLabs is busy. Press play to try again.',
  no_key: 'Your ElevenLabs key was removed. Add it again on the API keys page.',
  signed_out: 'Sign in again to use your ElevenLabs voice.',
  pro: proNotice('elevenlabs').heading,
}

const LOCAL_TEXT: Record<LocalProblemCode, string> = {
  local_missing: 'The Folio voice is no longer on this device. Download it again from Voice.',
  local_failed: 'The Folio voice couldn’t start on this device.',
}

const clock = (ms: number, timeZone?: string) =>
  new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone })

export function problemMessage(problem: Problem, timeZone?: string): string {
  switch (problem.kind) {
    case 'no-voice':
      return `This device has no ${problem.language} voice. You can add one in your system’s speech settings.`
    case 'unavailable':
      return 'This book isn’t available.'
    case 'load-failed':
      return 'Couldn’t load the next part of the book.'
    case 'voice-failed':
      return 'The voice stopped working. Try another voice.'
    case 'end-of-book':
      return 'End of the book'
    case 'blocked':
      return 'Press play to start.'
    case 'local':
      return LOCAL_TEXT[problem.code]
    case 'cloud':
      if (problem.code !== 'rate') return CLOUD_TEXT[problem.code]
      return problem.retryAt === undefined
        ? 'You’ve used ElevenLabs for a lot of reading this hour. Try again later.'
        : `You’ve used ElevenLabs for a lot of reading this hour. Try again at ${clock(problem.retryAt, timeZone)}.`
  }
}

export function problemLink(problem: Problem | null): string | null {
  return problem?.kind === 'cloud' && (problem.code === 'key_rejected' || problem.code === 'no_key')
    ? '/account/api-keys#elevenlabs'
    : null
}

export function offersDeviceVoice(problem: Problem | null): boolean {
  if (problem?.kind === 'local') return true
  return problem?.kind === 'cloud' && problem.code !== 'busy'
}

export function timeLeft(minutes: number): string {
  return minutes <= 0 ? 'Less than a minute left in this chapter' : `About ${minutes} min left in this chapter`
}

export const offerText = (bytes: number) => ({
  title: 'Try the Folio voice',
  body: `A natural voice that sounds the same on every device and works offline. ${aboutMegabytes(bytes)}, downloaded once.`,
})

export const DOWNLOADING_LABEL = 'Downloading the Folio voice'

export const downloadingText = (percent: number, short = false) =>
  `${short ? 'Downloading' : DOWNLOADING_LABEL}… ${percent}%`

export function localVoiceDetail(
  voice: { state: 'absent' | 'downloading' | 'ready'; percent: number; bytes: number; labels: string | null },
  online: boolean,
): string {
  if (voice.state === 'ready') return [voice.labels, 'On this device'].filter(Boolean).join(' · ')
  if (voice.state === 'downloading') return downloadingText(voice.percent, true)
  return online ? `Download · ${aboutMegabytes(voice.bytes)}` : 'Connect to the internet to download it.'
}

export const LOCAL_NOTE = 'Plays on this device. The book’s text isn’t sent anywhere.'

export const SLOW_NOTE =
  'This device makes the Folio voice more slowly than it reads, so there may be pauses. A device voice may sound smoother.'

export const removeLabel = (bytes: number) => `Remove Folio voices from this device (${megabytes(bytes)})`

export type DownloadNotice = { kind: 'ready' } | { kind: 'failed' } | { kind: 'no_room'; bytes: number }

export function noticeMessage(notice: DownloadNotice): string {
  switch (notice.kind) {
    case 'ready':
      return 'The Folio voice is ready.'
    case 'failed':
      return 'Couldn’t download the Folio voice. Check your connection and try again.'
    case 'no_room':
      return `There isn’t room on this device for the Folio voice (${megabytes(notice.bytes)}).`
  }
}
