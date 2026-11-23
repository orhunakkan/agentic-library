import { describe, expect, it } from 'vitest'
import {
  consentText,
  downloadingText,
  ELEVENLABS_NOTE,
  LOCAL_LINE,
  languageLine,
  offerText,
  onlineLine,
  READY_TEXT,
  STATUS,
  type VoiceErrorCode,
  vendorName,
  voiceErrorCode,
  voiceErrorText,
} from './voice-messages'

describe('voiceErrorText', () => {
  it.each<[VoiceErrorCode, string]>([
    ['no-speech', 'Didn’t catch anything. Press the microphone and try again.'],
    ['empty', 'Didn’t catch anything. Press the microphone and try again.'],
    ['not-allowed', 'Folio can’t use the microphone. Allow it in your browser’s site settings, then try again.'],
    ['service-not-allowed', 'Your browser won’t recognise speech here. Check its speech or privacy settings.'],
    ['audio-capture', 'No microphone was found.'],
    ['network', 'Speech recognition needs a connection right now. Check it and try again.'],
    ['language-not-supported', 'Your browser can’t recognise English speech. You can still type your question.'],
    ['unsupported', 'Your browser can’t recognise English speech. You can still type your question.'],
    ['download-failed', 'Couldn’t download speech recognition. Try again, or use online recognition.'],
    ['too-long', 'That was longer than a question can be (2,000 characters). Try a shorter one.'],
    ['voice-failed', 'The voice stopped working. Try another voice in read aloud.'],
    ['failed', 'Speech recognition stopped. Try again.'],
  ])('%s', (code, text) => {
    expect(voiceErrorText(code, 'English')).toBe(text)
  })

  it('names the book’s language', () => {
    expect(voiceErrorText('unsupported', 'Turkish')).toContain('Turkish speech')
  })
})

describe('voiceErrorCode', () => {
  it('keeps the browser’s codes and makes anything else failed', () => {
    expect(voiceErrorCode('not-allowed')).toBe('not-allowed')
    expect(voiceErrorCode('no-speech')).toBe('no-speech')
    expect(voiceErrorCode('phrases-not-supported')).toBe('failed')
    expect(voiceErrorCode('bad-grammar')).toBe('failed')
    expect(voiceErrorCode('')).toBe('failed')
  })
})

describe('the offer, the consent and the menu', () => {
  it('fills in the language', () => {
    expect(offerText('English')).toBe(
      'Download speech recognition for English? It’s recognised on this device, so nothing you say leaves it. Your browser downloads it once.',
    )
    expect(downloadingText('French')).toBe('Downloading speech recognition for French…')
    expect(languageLine('English')).toBe('Speech is recognised in English, the book’s language.')
  })

  it('names the vendor, or the browser’s maker', () => {
    expect(consentText('Google')).toBe(
      'To turn your voice into text, your browser sends what you say to Google. Folio gets only the text.',
    )
    expect(consentText('Apple')).toContain('to Apple.')
    expect(consentText(null)).toContain('to your browser’s maker.')
    expect(onlineLine('Microsoft')).toBe('Your browser sends what you say to Microsoft to turn it into text.')
    expect(vendorName(null)).toBe('your browser’s maker')
  })

  it('has the fixed lines', () => {
    expect(READY_TEXT).toBe('Speech recognition is ready.')
    expect(LOCAL_LINE).toBe('Recognised on this device. Nothing you say leaves it.')
    expect(ELEVENLABS_NOTE).toBe('Answers are read by your device’s voice. ElevenLabs reads only the book.')
    expect(STATUS).toEqual({
      listening: 'Listening…',
      sending: 'Sending your question…',
      speaking: 'Reading the answer…',
    })
  })
})
