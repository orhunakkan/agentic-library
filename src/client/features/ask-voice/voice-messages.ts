import { QUESTION_MAX } from '~/client/features/ask/ask-client'

export type VoiceErrorCode =
  | 'no-speech'
  | 'empty'
  | 'not-allowed'
  | 'service-not-allowed'
  | 'audio-capture'
  | 'network'
  | 'language-not-supported'
  | 'unsupported'
  | 'download-failed'
  | 'too-long'
  | 'voice-failed'
  | 'failed'

const BROWSER_CODES: readonly VoiceErrorCode[] = [
  'no-speech',
  'not-allowed',
  'service-not-allowed',
  'audio-capture',
  'network',
  'language-not-supported',
]

export const voiceErrorCode = (code: string): VoiceErrorCode => BROWSER_CODES.find((c) => c === code) ?? 'failed'

export type Vendor = 'Google' | 'Microsoft' | 'Apple' | null

export const vendorName = (vendor: Vendor) => vendor ?? 'your browser’s maker'

const limit = QUESTION_MAX.toLocaleString('en-GB')

export function voiceErrorText(code: VoiceErrorCode, language: string): string {
  switch (code) {
    case 'no-speech':
    case 'empty':
      return 'Didn’t catch anything. Press the microphone and try again.'
    case 'not-allowed':
      return 'Folio can’t use the microphone. Allow it in your browser’s site settings, then try again.'
    case 'service-not-allowed':
      return 'Your browser won’t recognise speech here. Check its speech or privacy settings.'
    case 'audio-capture':
      return 'No microphone was found.'
    case 'network':
      return 'Speech recognition needs a connection right now. Check it and try again.'
    case 'language-not-supported':
    case 'unsupported':
      return `Your browser can’t recognise ${language} speech. You can still type your question.`
    case 'download-failed':
      return 'Couldn’t download speech recognition. Try again, or use online recognition.'
    case 'too-long':
      return `That was longer than a question can be (${limit} characters). Try a shorter one.`
    case 'voice-failed':
      return 'The voice stopped working. Try another voice in read aloud.'
    default:
      return 'Speech recognition stopped. Try again.'
  }
}

export const offerText = (language: string) =>
  `Download speech recognition for ${language}? It’s recognised on this device, so nothing you say leaves it. Your browser downloads it once.`

export const downloadingText = (language: string) => `Downloading speech recognition for ${language}…`

export const READY_TEXT = 'Speech recognition is ready.'

export const consentText = (vendor: Vendor) =>
  `To turn your voice into text, your browser sends what you say to ${vendorName(vendor)}. Folio gets only the text.`

export const onlineLine = (vendor: Vendor) =>
  `Your browser sends what you say to ${vendorName(vendor)} to turn it into text.`

export const LOCAL_LINE = 'Recognised on this device. Nothing you say leaves it.'

export const languageLine = (language: string) => `Speech is recognised in ${language}, the book’s language.`

export const ELEVENLABS_NOTE = 'Answers are read by your device’s voice. ElevenLabs reads only the book.'

export const STATUS = {
  listening: 'Listening…',
  sending: 'Sending your question…',
  speaking: 'Reading the answer…',
} as const
