import { useEffect, useState } from 'react'
import { Button, Notice, TextField } from '~/client/features/account/ui'
import {
  type AppliesTo,
  type AskPromptView,
  checkPrompt,
  instructionLength,
  type PromptFields,
} from '~/shared/ask-prompts/prompts'
import type { PromptResult } from './ask-prompts-client'
import { APPLIES_TO_CHOICES, COUNTER_FROM, counterText, type PromptProblem, promptProblemText } from './prompt-messages'

export interface PromptDraft {
  name: string
  appliesTo: AppliesTo
  instruction: string
}

export const NAME_ID = 'field-prompt-name'

export const EMPTY_DRAFT: PromptDraft = { name: '', appliesTo: 'pages', instruction: '' }

export function PromptForm({
  initial,
  focusName = false,
  onSave,
  onCancel,
}: {
  initial: PromptDraft
  focusName?: boolean
  onSave: (fields: PromptFields) => Promise<PromptResult<AskPromptView>>
  onCancel?: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(initial.appliesTo)
  const [instruction, setInstruction] = useState(initial.instruction)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ problem: PromptProblem; name: string } | null>(null)
  useEffect(() => {
    if (focusName) document.getElementById(NAME_ID)?.focus()
  }, [focusName])

  const length = instructionLength(instruction)

  const submit = async () => {
    const fields = { name, appliesTo, instruction }
    const checked = checkPrompt(fields)
    if (!checked.ok) {
      setError({ problem: checked.reason === 'applies_to' ? 'failed' : checked.reason, name })
      return
    }
    setSaving(true)
    setError(null)
    const result = await onSave(fields)
    setSaving(false)
    if (!result.ok) setError({ problem: result.problem, name: checked.prompt.name })
    else if (!onCancel) {
      setName('')
      setAppliesTo('pages')
      setInstruction('')
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <TextField
        label="Name"
        name="prompt-name"
        autoComplete="off"
        placeholder="Explain like I’m new"
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-invalid={error?.problem.startsWith('name') || error?.problem === 'exists' ? true : undefined}
        aria-describedby={error ? 'prompt-error' : undefined}
      />
      <fieldset className="mt-5">
        <legend className="text-[14px] font-medium text-ink">Use it on</legend>
        <div className="mt-2 flex flex-col gap-2">
          {APPLIES_TO_CHOICES.map((choice) => (
            <label key={choice.value} className="flex min-h-11 items-start gap-2.5 text-[15px] text-ink">
              <input
                type="radio"
                name="prompt-applies-to"
                value={choice.value}
                checked={appliesTo === choice.value}
                onChange={() => setAppliesTo(choice.value)}
                aria-describedby={`prompt-applies-${choice.value}-hint`}
                data-testid={`prompt-applies-${choice.value}`}
                className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
              />
              <span>
                {choice.label}
                <span id={`prompt-applies-${choice.value}-hint`} className="block text-[13px] text-muted">
                  {choice.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-5">
        <label htmlFor="field-prompt-instruction" className="block text-[14px] font-medium text-ink">
          What it asks
        </label>
        <p id="prompt-instruction-hint" className="mt-1 text-[13px] text-muted">
          Write it as you’d ask Ask the book.
        </p>
        <textarea
          id="field-prompt-instruction"
          name="prompt-instruction"
          rows={4}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          aria-describedby={['prompt-instruction-hint', error ? 'prompt-error' : ''].filter(Boolean).join(' ')}
          aria-invalid={error?.problem.startsWith('instruction') || error?.problem === 'reserved' ? true : undefined}
          data-testid="prompt-instruction"
          className="mt-2 max-h-[13.75rem] min-h-28 w-full resize-y rounded-xl border border-line bg-page px-4 py-3 text-[16px] leading-6 text-ink outline-none transition [field-sizing:content] focus:border-accent focus:ring-4 focus:ring-accent/15 aria-[invalid=true]:border-red-500"
        />
        {length >= COUNTER_FROM && (
          <p
            className={
              length > 2_000
                ? 'mt-1 text-[13px] font-medium text-red-700 dark:text-red-300'
                : 'mt-1 text-[13px] text-muted'
            }
            aria-live="polite"
            data-testid="prompt-count"
          >
            {counterText(length)}
          </p>
        )}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button data-testid="prompt-save" disabled={saving} aria-busy={saving || undefined}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} data-testid="prompt-cancel">
            Cancel
          </Button>
        )}
      </div>
      {error && (
        <Notice kind="error" id="prompt-error" data-testid="prompt-error">
          {promptProblemText(error.problem, error.name)}
        </Notice>
      )}
    </form>
  )
}
