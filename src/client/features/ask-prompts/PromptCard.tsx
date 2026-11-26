import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '~/client/features/account/ui'
import type { AskPromptView } from '~/shared/ask-prompts/prompts'
import { appliesToText, moveLabel } from './prompt-messages'

const iconButton =
  'grid size-12 shrink-0 place-items-center rounded-xl border border-line bg-surface text-ink transition hover:border-accent-line hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40'

export function PromptCard({
  prompt,
  first,
  last,
  onEdit,
  onMove,
  onDelete,
}: {
  prompt: AskPromptView
  first: boolean
  last: boolean
  onEdit: () => void
  onMove: (direction: 'up' | 'down') => void
  onDelete: () => void
}) {
  return (
    <li
      className="rounded-[22px] border border-line bg-surface p-5 md:p-6"
      data-testid="prompt-card"
      data-key={prompt.id}
    >
      <h2 className="text-[17px] font-bold break-words text-ink">{prompt.name}</h2>
      <p className="mt-1 text-[14px] text-muted" data-testid="prompt-applies-to">
        {appliesToText(prompt.appliesTo)}
      </p>
      <p className="mt-3 line-clamp-3 text-[15px] leading-relaxed break-words whitespace-pre-line text-body">
        {prompt.instruction}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2 sm:gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={onEdit}
          data-testid="prompt-edit"
          data-prompt-edit={prompt.id}
        >
          Edit
        </Button>
        <button
          type="button"
          className={iconButton}
          disabled={first}
          aria-label={moveLabel(prompt.name, 'up')}
          onClick={() => onMove('up')}
          data-testid="prompt-move-up"
        >
          <ArrowUp className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          className={iconButton}
          disabled={last}
          aria-label={moveLabel(prompt.name, 'down')}
          onClick={() => onMove('down')}
          data-testid="prompt-move-down"
        >
          <ArrowDown className="size-5" aria-hidden />
        </button>
        <Button type="button" variant="danger" onClick={onDelete} data-testid="prompt-delete">
          Delete
        </Button>
      </div>
    </li>
  )
}
