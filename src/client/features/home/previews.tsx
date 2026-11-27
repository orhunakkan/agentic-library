import { ListOrdered, Mic, Moon, Pause, SkipBack, SkipForward } from 'lucide-react'
import type { ReactNode } from 'react'
import { timeLeft } from '~/client/features/read-aloud/messages'
import { BOOK_TITLE, FEATURE_ASK, label, READ_ALOUD } from './sample'

export function PreviewCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-line bg-surface p-5 shadow-[0_18px_50px_-30px_rgb(0_0_0/0.45)] sm:p-6 ${className}`}
    >
      {children}
    </div>
  )
}

export function Chip({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <span
      className={
        accent
          ? 'inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[12.5px] font-semibold whitespace-nowrap text-accent'
          : 'inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12.5px] font-medium whitespace-nowrap text-body'
      }
    >
      {children}
    </span>
  )
}

export function ReadAloudPreview() {
  return (
    <PreviewCard>
      <p className="text-[12px] font-semibold tracking-[0.14em] text-muted uppercase">Now playing</p>
      <p className="mt-2 font-display text-[24px] font-bold text-ink">{READ_ALOUD.title}</p>
      <p className="text-[14px] text-muted">{BOOK_TITLE}</p>
      <p className="mt-4 text-[14px] text-body">{timeLeft(READ_ALOUD.minutesLeft)}</p>
      <div className="mt-3 h-1.5 rounded-full bg-panel">
        <div className="h-full w-[3%] rounded-full bg-hue-cyan" />
      </div>
      <div className="mt-5 flex items-center justify-center gap-6 text-ink">
        <SkipBack className="size-5" />
        <span className="grid size-12 place-items-center rounded-full bg-accent-fill text-on-accent">
          <Pause className="size-5" />
        </span>
        <SkipForward className="size-5" />
      </div>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Chip>Speed 1.0x</Chip>
        <Chip>Voice</Chip>
        <Chip>
          <ListOrdered className="size-3.5" />
          Chapters
        </Chip>
        <Chip>
          <Moon className="size-3.5" />
          Sleep
        </Chip>
      </div>
    </PreviewCard>
  )
}

export function AskPreview() {
  return (
    <PreviewCard className="flex flex-col gap-4 text-[14px]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted">Using pages up to {label(FEATURE_ASK.scope)}</p>
        <span className="flex shrink-0 items-center gap-2 text-[12.5px] text-body">
          Whole book
          <span className="flex h-5 w-9 items-center rounded-full bg-panel p-0.5">
            <span className="size-4 rounded-full bg-faint" />
          </span>
        </span>
      </div>
      <p className="self-end rounded-2xl rounded-br-md bg-panel px-3.5 py-2.5 text-ink">{FEATURE_ASK.question}</p>
      <p className="leading-relaxed text-body">
        {FEATURE_ASK.answer} “{FEATURE_ASK.quote.text}.” <Chip accent>{label(FEATURE_ASK.quote)}</Chip>
      </p>
      <blockquote className="border-l-2 border-hue-violet pl-3 font-serif text-[14.5px] leading-relaxed text-muted">
        …{FEATURE_ASK.quote.text}…
      </blockquote>
      <div className="flex items-center gap-3 rounded-full border border-line px-4 py-2">
        <span className="flex-1 truncate text-muted">Ask a question about the book</span>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-hue-violet/15 text-hue-violet-ink">
          <Mic className="size-4" />
        </span>
      </div>
    </PreviewCard>
  )
}
