import { describe, expect, it } from 'vitest'
import {
  DOWNLOADING_LABEL,
  downloadingText,
  LOCAL_NOTE,
  localVoiceDetail,
  noticeMessage,
  offersDeviceVoice,
  offerText,
  problemLink,
  problemMessage,
  removeLabel,
  SLOW_NOTE,
  timeLeft,
} from '~/client/features/read-aloud/messages'

describe('problemMessage', () => {
  it('says why reading stopped, in plain words', () => {
    expect(problemMessage({ kind: 'no-voice', language: 'Turkish' })).toBe(
      'This device has no Turkish voice. You can add one in your system’s speech settings.',
    )
    expect(problemMessage({ kind: 'unavailable' })).toBe('This book isn’t available.')
    expect(problemMessage({ kind: 'load-failed' })).toBe('Couldn’t load the next part of the book.')
    expect(problemMessage({ kind: 'voice-failed' })).toBe('The voice stopped working. Try another voice.')
    expect(problemMessage({ kind: 'end-of-book' })).toBe('End of the book')
  })

  it('asks for a press when the browser blocked playback, whichever voice was speaking', () => {
    expect(problemMessage({ kind: 'blocked' })).toBe('Press play to start.')
    expect(problemLink({ kind: 'blocked' })).toBeNull()
    expect(offersDeviceVoice({ kind: 'blocked' })).toBe(false)
  })
})

describe('ElevenLabs problems', () => {
  it('say what to do, each in its own words', () => {
    const say = (code: string) => problemMessage({ kind: 'cloud', code: code as never })
    expect(say('key_rejected')).toBe('ElevenLabs rejected your key. Check it on the API keys page.')
    expect(say('no_credits')).toBe('Your ElevenLabs account is out of credits.')
    expect(say('permission')).toBe(
      'Your ElevenLabs key isn’t allowed to make speech. Allow it Text to Speech in ElevenLabs.',
    )
    expect(say('voice_gone')).toBe('This ElevenLabs voice is no longer available. Pick another voice.')
    expect(say('busy')).toBe('ElevenLabs is busy. Press play to try again.')
    expect(say('no_key')).toBe('Your ElevenLabs key was removed. Add it again on the API keys page.')
    expect(say('signed_out')).toBe('Sign in again to use your ElevenLabs voice.')
  })

  it('say when the hourly limit allows more, in the reader’s time', () => {
    const retryAt = Date.UTC(2026, 10, 7, 14, 5)
    expect(problemMessage({ kind: 'cloud', code: 'rate', retryAt }, 'UTC')).toBe(
      'You’ve used ElevenLabs for a lot of reading this hour. Try again at 14:05.',
    )
    expect(problemMessage({ kind: 'cloud', code: 'rate', retryAt }, 'Europe/Istanbul')).toContain('at 17:05.')
    expect(problemMessage({ kind: 'cloud', code: 'rate' })).toBe(
      'You’ve used ElevenLabs for a lot of reading this hour. Try again later.',
    )
  })

  it('link to the API keys page for the key’s problems, and offer the device voice unless Play fixes it', () => {
    expect(problemLink({ kind: 'cloud', code: 'key_rejected' })).toBe('/account/api-keys#elevenlabs')
    expect(problemLink({ kind: 'cloud', code: 'no_key' })).toBe('/account/api-keys#elevenlabs')
    expect(problemLink({ kind: 'cloud', code: 'no_credits' })).toBeNull()
    expect(problemLink({ kind: 'voice-failed' })).toBeNull()
    expect(problemLink(null)).toBeNull()
    expect(offersDeviceVoice({ kind: 'cloud', code: 'no_credits' })).toBe(true)
    expect(offersDeviceVoice({ kind: 'cloud', code: 'voice_gone' })).toBe(true)
    expect(offersDeviceVoice({ kind: 'cloud', code: 'busy' })).toBe(false)
    expect(offersDeviceVoice({ kind: 'load-failed' })).toBe(false)
    expect(offersDeviceVoice(null)).toBe(false)
  })
})

describe('timeLeft', () => {
  it('estimates the minutes left in the chapter', () => {
    expect(timeLeft(14)).toBe('About 14 min left in this chapter')
    expect(timeLeft(0)).toBe('Less than a minute left in this chapter')
  })
})

describe('the Folio voice', () => {
  it('says its problems and offers the device voice for both', () => {
    expect(problemMessage({ kind: 'local', code: 'local_missing' })).toBe(
      'The Folio voice is no longer on this device. Download it again from Voice.',
    )
    expect(problemMessage({ kind: 'local', code: 'local_failed' })).toBe(
      'The Folio voice couldn’t start on this device.',
    )
    expect(offersDeviceVoice({ kind: 'local', code: 'local_missing' })).toBe(true)
    expect(offersDeviceVoice({ kind: 'local', code: 'local_failed' })).toBe(true)
    expect(problemLink({ kind: 'local', code: 'local_failed' })).toBeNull()
  })

  it('offers itself with the first download’s size', () => {
    expect(offerText(96_789_939)).toEqual({
      title: 'Try the Folio voice',
      body: 'A natural voice that sounds the same on every device and works offline. About 92 MB, downloaded once.',
    })
  })

  it('counts a download in the sheet and the menu', () => {
    expect(downloadingText(45)).toBe('Downloading the Folio voice… 45%')
    expect(downloadingText(45, true)).toBe('Downloading… 45%')
    expect(DOWNLOADING_LABEL).toBe('Downloading the Folio voice')
  })

  it('describes each voice in the menu', () => {
    const voice = { state: 'ready' as const, percent: 0, bytes: 63_228_626, labels: 'United Kingdom · female' }
    expect(localVoiceDetail(voice, true)).toBe('United Kingdom · female · On this device')
    expect(localVoiceDetail({ ...voice, labels: null }, false)).toBe('On this device')
    expect(localVoiceDetail({ ...voice, state: 'absent' }, true)).toBe('Download · About 60 MB')
    expect(localVoiceDetail({ ...voice, state: 'absent' }, false)).toBe('Connect to the internet to download it.')
    expect(localVoiceDetail({ ...voice, state: 'downloading', percent: 12 }, true)).toBe('Downloading… 12%')
    expect(LOCAL_NOTE).toBe('Plays on this device. The book’s text isn’t sent anywhere.')
    expect(SLOW_NOTE).toMatch(/^This device makes the Folio voice more slowly than it reads/)
    expect(removeLabel(63_228_626)).toBe('Remove Folio voices from this device (60 MB)')
  })

  it('ends a download with a toast', () => {
    expect(noticeMessage({ kind: 'ready' })).toBe('The Folio voice is ready.')
    expect(noticeMessage({ kind: 'failed' })).toBe(
      'Couldn’t download the Folio voice. Check your connection and try again.',
    )
    expect(noticeMessage({ kind: 'no_room', bytes: 96_789_939 })).toBe(
      'There isn’t room on this device for the Folio voice (92 MB).',
    )
  })
})
