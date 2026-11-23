import type { ReactNode } from 'react'
import { cn } from '~/client/lib/cn'
import type { AskVoice } from './use-ask-voice'
import {
  consentText,
  downloadingText,
  ELEVENLABS_NOTE,
  offerText,
  READY_TEXT,
  STATUS,
  voiceErrorText,
} from './voice-messages'
import { statusOf } from './voice-turn'

const card = 'mb-2 rounded-xl border border-r-line bg-r-page px-3.5 py-3 text-[13.5px] leading-relaxed'
const primary =
  'inline-flex min-h-9 items-center rounded-full bg-r-accent px-4 text-[13px] font-semibold text-r-paper transition hover:brightness-105'
const secondary =
  'inline-flex min-h-9 items-center rounded-full border border-r-line px-4 text-[13px] font-medium transition hover:border-r-accent/60'

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-wrap gap-2">{children}</div>
}

export function VoiceNotices({ voice }: { voice: AskVoice }) {
  const { turn, language } = voice
  const status = statusOf(turn)
  return (
    <>
      {turn.phase === 'offer' && (
        <div className={card} data-testid="ask-voice-offer">
          {turn.failed ? (
            <p role="alert" data-testid="ask-voice-error">
              {voiceErrorText('download-failed', language)}
            </p>
          ) : (
            <p>{offerText(language)}</p>
          )}
          <Actions>
            <button type="button" onClick={voice.download} className={primary} data-testid="ask-voice-download">
              Download
            </button>
            {voice.online && (
              <button type="button" onClick={voice.useOnline} className={secondary} data-testid="ask-voice-use-online">
                Use online recognition
              </button>
            )}
            <button type="button" onClick={voice.notNow} className={secondary} data-testid="ask-voice-not-now">
              Not now
            </button>
          </Actions>
        </div>
      )}
      {turn.phase === 'downloading' && (
        <div className={card} data-testid="ask-voice-downloading">
          <p>{downloadingText(language)}</p>
          <Actions>
            <button type="button" onClick={voice.cancel} className={secondary} data-testid="ask-voice-download-cancel">
              Cancel
            </button>
          </Actions>
        </div>
      )}
      {turn.phase === 'consent' && (
        <div className={card} data-testid="ask-voice-online-note">
          <p>{consentText(voice.vendor)}</p>
          <Actions>
            <button type="button" onClick={voice.consent} className={primary} data-testid="ask-voice-online-ok">
              Use voice
            </button>
            <button type="button" onClick={voice.decline} className={secondary} data-testid="ask-voice-online-cancel">
              Cancel
            </button>
          </Actions>
        </div>
      )}
      {turn.phase === 'error' && turn.error && (
        <p role="alert" className={card} data-testid="ask-voice-error">
          {voiceErrorText(turn.error, language)}
        </p>
      )}
      {turn.ready && (
        <p className="mb-2 text-[12.5px] text-r-muted" data-testid="ask-voice-ready">
          {READY_TEXT}
        </p>
      )}
      {voice.elevenLabsNote && (
        <p className="mb-2 text-[12.5px] text-r-muted" data-testid="ask-voice-elevenlabs-note">
          {ELEVENLABS_NOTE}
        </p>
      )}
      <div className={cn('flex items-center gap-2 text-[13px] text-r-muted', status && 'mb-2')}>
        <p aria-live="polite" className="flex items-center gap-2" data-testid="ask-voice-status">
          {status === 'listening' && (
            <span aria-hidden className="size-2 rounded-full bg-r-accent motion-safe:animate-pulse" />
          )}
          {status ? STATUS[status] : ''}
        </p>
        {status === 'speaking' && (
          <button
            type="button"
            onClick={voice.stopSpeaking}
            data-testid="ask-voice-stop-speaking"
            className="ml-auto inline-flex min-h-9 items-center rounded-full border border-r-line px-3.5 text-[13px] text-r-ink transition hover:border-r-accent/60"
          >
            Stop speaking
          </button>
        )}
      </div>
    </>
  )
}
