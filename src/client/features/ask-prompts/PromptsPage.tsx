import { useState } from 'react'
import { useToast } from '~/client/components/Toast'
import { AccountPage, Button, Notice, Section } from '~/client/features/account/ui'
import { DialogTitle, Modal } from '~/client/features/admin/ConfirmDialog'
import { type AskPromptsState, type AskPromptView, MAX_ASK_PROMPTS } from '~/shared/ask-prompts/prompts'
import { STARTER_PROMPTS } from '~/shared/ask-prompts/starters'
import { PromptCard } from './PromptCard'
import { EMPTY_DRAFT, NAME_ID, type PromptDraft, PromptForm } from './PromptForm'
import {
  appliesToText,
  countText,
  deleteQuestion,
  EMPTY_TEXT,
  PROMPTS_INTRO,
  type PromptProblem,
  type PromptStatus,
  promptProblemText,
  statusText,
} from './prompt-messages'
import { useAskPrompts } from './use-ask-prompts'

const focusEdit = (id: string) =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-prompt-edit="${id}"]`)?.focus())

function Starters({ onUse }: { onUse: (draft: PromptDraft) => void }) {
  return (
    <>
      <p className="mt-10 text-[15px] text-body" data-testid="prompts-empty">
        {EMPTY_TEXT}
      </p>
      <ul className="mt-4 flex flex-col gap-4">
        {STARTER_PROMPTS.map((starter) => (
          <li
            key={starter.key}
            className="rounded-[22px] border border-dashed border-line p-5 md:p-6"
            data-testid="prompt-starter"
            data-key={starter.key}
          >
            <h2 className="text-[17px] font-bold text-ink">{starter.name}</h2>
            <p className="mt-1 text-[14px] text-muted">{appliesToText(starter.appliesTo)}</p>
            <p className="mt-3 text-[15px] leading-relaxed text-body">{starter.instruction}</p>
            <Button
              type="button"
              variant="secondary"
              className="mt-4"
              onClick={() => onUse(starter)}
              aria-label={`Use “${starter.name}”`}
              data-testid="prompt-starter-use"
            >
              Use this
            </Button>
          </li>
        ))}
      </ul>
    </>
  )
}

function DeleteDialog({
  prompt,
  onClose,
  onDelete,
}: {
  prompt: AskPromptView | null
  onClose: () => void
  onDelete: (prompt: AskPromptView) => void
}) {
  return (
    <Modal open={prompt !== null} labelledBy="prompt-delete-title" onClose={onClose}>
      {prompt && (
        <>
          <DialogTitle id="prompt-delete-title">Delete prompt</DialogTitle>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">{deleteQuestion(prompt.name)}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button type="button" variant="danger" onClick={() => onDelete(prompt)} data-testid="prompt-delete-confirm">
              Delete
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} data-testid="prompt-delete-cancel">
              Cancel
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

function PromptsList({ initial }: { initial: readonly AskPromptView[] }) {
  const { prompts, create, edit, move, remove } = useAskPrompts(initial)
  const toast = useToast()
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AskPromptView | null>(null)
  const [status, setStatus] = useState<{ status: PromptStatus; name: string; n: number } | null>(null)
  const [draft, setDraft] = useState<{ draft: PromptDraft; n: number }>({ draft: EMPTY_DRAFT, n: 0 })

  const report = (next: PromptStatus, name: string) => setStatus((s) => ({ status: next, name, n: (s?.n ?? 0) + 1 }))
  const refused = (problem: PromptProblem) => toast(promptProblemText(problem))

  const onMove = async (prompt: AskPromptView, direction: 'up' | 'down') => {
    const result = await move(prompt.id, direction)
    if (result.ok) report(direction === 'up' ? 'moved-up' : 'moved-down', prompt.name)
    else refused(result.problem)
  }

  const onDelete = async (prompt: AskPromptView) => {
    setDeleting(null)
    const result = await remove(prompt.id)
    if (result.ok || result.problem === 'not_found') report('deleted', prompt.name)
    else refused(result.problem)
  }

  const full = prompts.length >= MAX_ASK_PROMPTS

  return (
    <>
      <p className="mt-8 text-[14px] font-medium text-muted" data-testid="prompts-count">
        {countText(prompts.length)}
      </p>
      <p className="sr-only" role="status" aria-live="polite" data-testid="prompts-status" key={status?.n}>
        {status ? statusText(status.status, status.name) : ''}
      </p>
      {!full && editing === null && (
        <Section id="new-prompt" title="New prompt">
          <PromptForm
            key={draft.n}
            initial={draft.draft}
            focusName={draft.n > 0}
            onSave={async (fields) => {
              const result = await create(fields)
              if (result.ok) {
                report('saved', result.value.name)
                setDraft({ draft: EMPTY_DRAFT, n: 0 })
              }
              return result
            }}
          />
        </Section>
      )}
      {prompts.length === 0 && (
        <Starters
          onUse={(starter) => {
            setDraft((d) => ({ draft: starter, n: d.n + 1 }))
            requestAnimationFrame(() => document.getElementById(NAME_ID)?.focus())
          }}
        />
      )}
      {prompts.length > 0 && (
        <ul className="mt-6 flex flex-col gap-4" aria-label="Your prompts">
          {prompts.map((prompt, i) =>
            editing === prompt.id ? (
              <li
                key={prompt.id}
                className="rounded-[22px] border border-accent-line bg-surface p-5 md:p-6"
                data-testid="prompt-card"
                data-key={prompt.id}
              >
                <PromptForm
                  initial={prompt}
                  focusName
                  onSave={async (fields) => {
                    const result = await edit(prompt.id, fields)
                    if (result.ok) {
                      setEditing(null)
                      report('saved', result.value.name)
                      focusEdit(prompt.id)
                    } else if (result.problem === 'not_found') {
                      setEditing(null)
                      refused('not_found')
                    }
                    return result
                  }}
                  onCancel={() => {
                    setEditing(null)
                    focusEdit(prompt.id)
                  }}
                />
              </li>
            ) : (
              <PromptCard
                key={prompt.id}
                prompt={prompt}
                first={i === 0}
                last={i === prompts.length - 1}
                onEdit={() => setEditing(prompt.id)}
                onMove={(direction) => void onMove(prompt, direction)}
                onDelete={() => setDeleting(prompt)}
              />
            ),
          )}
        </ul>
      )}
      <DeleteDialog prompt={deleting} onClose={() => setDeleting(null)} onDelete={(p) => void onDelete(p)} />
    </>
  )
}

export function PromptsPage({ state }: { state: AskPromptsState }) {
  return (
    <AccountPage eyebrow="Account" title="Your prompts" titleTestId="prompts-title" lead={PROMPTS_INTRO} nav>
      {state.state === 'ready' ? (
        <PromptsList key={state.prompts.map((p) => p.id).join()} initial={state.prompts} />
      ) : (
        <Notice kind="error" data-testid="prompts-error">
          {promptProblemText(state.state === 'signed_out' ? 'signed_out' : 'failed')}
        </Notice>
      )}
    </AccountPage>
  )
}
