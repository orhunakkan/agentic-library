import { AudioLines, MessagesSquare, Moon, Pause, SkipBack, SkipForward } from 'lucide-react'
import type { ReactNode } from 'react'
import { BOOK_TITLE, label, OPENING, READER_ASK } from './sample'

const PAGE = label(OPENING[0])

function Control({ children, active }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      className={
        active
          ? 'flex h-9 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-[13px] font-semibold text-accent'
          : 'flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-body'
      }
    >
      {children}
    </span>
  )
}

function Page() {
  const [first, second, netherfield, ...rest] = OPENING
  return (
    <div className="bg-surface px-5 py-7 font-serif text-[16px] leading-[1.8] text-body sm:px-10 sm:py-9 sm:text-[17px]">
      <p className="mb-5 font-sans text-[12px] font-semibold tracking-[0.14em] text-muted uppercase">Chapter 1</p>
      <p>
        <span className="preview-highlight">{first.text}</span>
      </p>
      <p className="mt-4">{second.text}</p>
      <p className="mt-4">
        <span className="preview-speaking">{netherfield.text}</span>
      </p>
      {rest.map((p) => (
        <p key={p.text} className="mt-4 max-sm:hidden">
          {p.text}
        </p>
      ))}
    </div>
  )
}

function AskPanel() {
  return (
    <div className="flex flex-col gap-4 border-t border-line bg-inset p-5 text-[14px] min-[900px]:border-t-0 min-[900px]:border-l">
      <div>
        <p className="font-display text-[16px] font-semibold text-ink">Ask this book</p>
        <p className="mt-1 text-[13px] text-muted">Using pages up to {label(READER_ASK.scope)}</p>
      </div>
      <p className="self-end rounded-2xl rounded-br-md bg-panel px-3.5 py-2.5 text-ink">{READER_ASK.question}</p>
      <p className="leading-relaxed text-body">
        {READER_ASK.answer} “{READER_ASK.quote.text}”{' '}
        <span className="ml-0.5 inline-flex rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-accent">
          {label(READER_ASK.quote)}
        </span>
      </p>
    </div>
  )
}

function PlayerBar() {
  return (
    <div className="flex items-center gap-3 border-t border-line bg-surface px-3 py-2.5 sm:px-4">
      <img
        src="/home/pride-and-prejudice.jpg"
        alt=""
        width={64}
        height={88}
        className="h-11 w-8 shrink-0 rounded-[4px] object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-ink">{BOOK_TITLE}</p>
        <p className="truncate text-[12.5px] text-muted">{PAGE} · Device voice</p>
      </div>
      <div className="flex items-center gap-1 text-ink">
        <SkipBack className="size-4 max-[400px]:hidden" />
        <span className="grid size-9 place-items-center rounded-full bg-accent-fill text-on-accent">
          <Pause className="size-4" />
        </span>
        <SkipForward className="size-4 max-[400px]:hidden" />
      </div>
      <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12.5px] text-body sm:flex">
        <Moon className="size-3.5" />
        Sleep · 12 min
      </span>
    </div>
  )
}

export function ReaderPreview() {
  return (
    <figure className="mt-14 sm:mt-16">
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-2xl border border-line bg-page shadow-[0_24px_80px_-32px_rgb(0_0_0/0.5)]"
      >
        <div className="flex h-12 items-center gap-2 border-b border-line bg-page px-3 sm:px-4">
          <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{BOOK_TITLE} · Chapter 1</p>
          <Control active>
            <AudioLines className="size-4" />
            <span className="max-sm:hidden">Pause reading</span>
          </Control>
          <Control>
            <MessagesSquare className="size-4" />
            <span className="max-sm:hidden">Ask</span>
          </Control>
          <Control>Aa</Control>
        </div>
        <div className="grid min-[900px]:grid-cols-[minmax(0,1fr)_340px]">
          <Page />
          <AskPanel />
        </div>
        <PlayerBar />
      </div>
      <figcaption className="mx-auto mt-4 max-w-[560px] text-center text-[14px] text-muted">
        Reading aloud marks each sentence as it’s spoken. Ask the book answers from the pages so far, with a link to the
        page.
      </figcaption>
    </figure>
  )
}
