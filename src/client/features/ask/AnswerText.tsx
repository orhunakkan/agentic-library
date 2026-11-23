import { PreviewCard } from '@base-ui/react/preview-card'
import { Fragment } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { type Block, type Inline, parseAnswer, readableCitation } from './answer-format'
import type { ThreadCitation } from './thread-store'

function CitationChip({ citation, onNavigate }: { citation: ThreadCitation; onNavigate?: () => void }) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={150}
        closeDelay={100}
        render={
          <AppLink
            href={citation.pageHref}
            preload={false}
            onClick={onNavigate}
            data-testid="ask-citation"
            data-key={citation.label}
            aria-label={`Source: ${citation.label}`}
            className="mx-0.5 inline-flex items-center rounded-full border border-r-line bg-r-page px-2 py-px align-baseline font-sans text-[11.5px] font-medium whitespace-nowrap text-r-accent no-underline transition hover:border-r-accent/60 focus-visible:outline-2 focus-visible:outline-r-accent"
          />
        }
      >
        {citation.label}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="top" sideOffset={8} collisionPadding={12} className="z-[80]">
          <PreviewCard.Popup
            data-testid="ask-citation-preview"
            className="max-w-[min(340px,calc(100vw-24px))] rounded-xl border border-r-line bg-r-paper px-3.5 py-2.5 font-serif text-[13.5px] leading-relaxed whitespace-pre-line text-r-ink shadow-[0_18px_40px_-18px_rgba(9,13,27,.45)] transition duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0"
          >
            {readableCitation(citation.citedText)}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}

function Inlines({
  inlines,
  citations,
  onNavigate,
}: {
  inlines: Inline[]
  citations: readonly ThreadCitation[]
  onNavigate?: () => void
}) {
  return inlines.map((inline, i) => {
    const key = `${inline.kind}-${i}`
    switch (inline.kind) {
      case 'text':
        return <Fragment key={key}>{inline.text}</Fragment>
      case 'strong':
        return <strong key={key}>{inline.text}</strong>
      case 'code':
        return (
          <code key={key} className="rounded bg-r-line/50 px-1 py-px font-mono text-[0.9em]">
            {inline.text}
          </code>
        )
      case 'cite': {
        const citation = citations[inline.index]
        return citation ? <CitationChip key={key} citation={citation} onNavigate={onNavigate} /> : null
      }
    }
    return null
  })
}

function BlockView({
  block,
  citations,
  onNavigate,
}: {
  block: Block
  citations: readonly ThreadCitation[]
  onNavigate?: () => void
}) {
  if (block.kind === 'code') {
    return (
      <pre className="overflow-x-auto rounded-lg bg-r-line/40 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed">
        <code>{block.text}</code>
      </pre>
    )
  }
  if (block.kind === 'list') {
    const List = block.ordered ? 'ol' : 'ul'
    return (
      <List className={block.ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-5'}>
        {block.items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: items have no identity beyond their place in the answer
          <li key={i}>
            <Inlines inlines={item} citations={citations} onNavigate={onNavigate} />
          </li>
        ))}
      </List>
    )
  }
  return (
    <p>
      <Inlines inlines={block.inlines} citations={citations} onNavigate={onNavigate} />
    </p>
  )
}

export function AnswerText({
  text,
  citations,
  onNavigate,
}: {
  text: string
  citations: readonly ThreadCitation[]
  onNavigate?: () => void
}) {
  return (
    <div className="space-y-2.5 text-[14.5px] leading-relaxed [overflow-wrap:anywhere]">
      {parseAnswer(text).map((block, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are re-parsed from the text on every render
        <BlockView key={i} block={block} citations={citations} onNavigate={onNavigate} />
      ))}
    </div>
  )
}
