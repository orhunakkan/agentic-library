import { Popover } from '@base-ui/react/popover'
import { Switch } from '@base-ui/react/switch'
import { ChevronDown, Mic, MicOff, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '~/client/lib/cn'
import type { AskVoice } from './use-ask-voice'
import { LOCAL_LINE, languageLine, onlineLine } from './voice-messages'

const round =
  'grid size-9 shrink-0 place-items-center rounded-full text-r-ink transition hover:bg-r-line/60 disabled:opacity-40'

export function MicButton({ voice }: { voice: AskVoice }) {
  const listening = voice.turn.phase === 'listening'
  return (
    <div className="flex shrink-0 items-center">
      {listening && (
        <button
          type="button"
          onClick={voice.cancel}
          aria-label="Cancel"
          data-testid="ask-voice-cancel"
          className={cn(round, 'text-r-muted hover:text-r-ink')}
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
      <button
        type="button"
        onClick={voice.press}
        disabled={voice.turn.phase === 'downloading'}
        aria-pressed={listening}
        aria-label={listening ? 'Stop and send' : 'Ask by voice'}
        data-testid="ask-voice"
        className={cn(round, listening && 'bg-r-accent/15 text-r-accent hover:bg-r-accent/20')}
      >
        {listening ? <MicOff className="size-4.5" aria-hidden /> : <Mic className="size-4.5" aria-hidden />}
      </button>
      <VoiceMenu voice={voice} />
    </div>
  )
}

function Row({
  label,
  checked,
  onChange,
  testId,
  children,
}: {
  label: string
  checked: boolean
  onChange: (on: boolean) => void
  testId: string
  children?: ReactNode
}) {
  return (
    <div className="py-1.5">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: Switch.Root renders the switch button this label wraps */}
      <label className="flex cursor-pointer items-center justify-between gap-3 text-[13.5px]">
        <span>{label}</span>
        <Switch.Root
          checked={checked}
          onCheckedChange={onChange}
          aria-label={label}
          data-testid={testId}
          className="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-r-line bg-r-line/70 p-0.5 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-r-accent data-[checked]:border-r-accent data-[checked]:bg-r-accent"
        >
          <Switch.Thumb className="size-4.5 rounded-full bg-r-paper shadow transition-transform data-[checked]:translate-x-4" />
        </Switch.Root>
      </label>
      {children}
    </div>
  )
}

function VoiceMenu({ voice }: { voice: AskVoice }) {
  return (
    <Popover.Root onOpenChange={(open) => open && voice.probe()}>
      <Popover.Trigger
        aria-label="Ask by voice settings"
        data-testid="ask-voice-menu"
        className="grid h-9 w-6 shrink-0 place-items-center rounded-full text-r-muted transition hover:bg-r-line/60 hover:text-r-ink data-popup-open:text-r-ink"
      >
        <ChevronDown className="size-3.5" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={8} collisionPadding={12} className="z-[100]">
          <Popover.Popup className="w-[min(300px,calc(100vw-24px))] origin-[var(--transform-origin)] rounded-2xl border border-r-line bg-r-paper px-4 py-3 font-sans text-r-ink shadow-[0_30px_70px_-24px_rgba(9,13,27,.45)] transition duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Popover.Title className="sr-only">Ask by voice</Popover.Title>
            <Row label="Read answers aloud" checked={voice.speak} onChange={voice.setSpeak} testId="ask-voice-speak" />
            {voice.online && (
              <Row
                label="Use online recognition"
                checked={voice.consented}
                onChange={voice.setConsented}
                testId="ask-voice-online-switch"
              >
                <p className="mt-0.5 pr-12 text-[12.5px] leading-snug text-r-muted">{onlineLine(voice.vendor)}</p>
              </Row>
            )}
            <div className="mt-2 space-y-1 border-t border-r-line pt-2.5 text-[12.5px] leading-snug text-r-muted">
              {voice.mode === 'local' && <p data-testid="ask-voice-local">{LOCAL_LINE}</p>}
              <p>{languageLine(voice.language)}</p>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
