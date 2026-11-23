import { useRouter } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { Button, Notice } from '~/client/features/account/ui'
import { deviceZone } from '~/client/features/sync/outbox'
import { GOAL_CHOICES } from '~/shared/reading-stats/goals'
import { type GoalProblem, saveGoal } from './stats-client'
import { GOAL_ERRORS, goalChoiceLabel, goalSavedLine } from './stats-copy'

export function GoalForm({ goalMinutes }: { goalMinutes: number }) {
  const router = useRouter()
  const [minutes, setMinutes] = useState(goalMinutes)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<number | null>(null)
  const [problem, setProblem] = useState<GoalProblem | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setSaved(null)
    setProblem(null)
    const result = await saveGoal(minutes, deviceZone() ?? 'UTC')
    setSaving(false)
    if (!result.ok) {
      setProblem(result.problem)
      return
    }
    setSaved(result.value.minutes)
    await router.invalidate()
  }

  return (
    <form onSubmit={onSubmit}>
      <label htmlFor="stats-goal" className="block text-[14px] font-medium text-ink">
        Daily goal
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <select
          id="stats-goal"
          data-testid="stats-goal"
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          className="h-12 min-w-0 flex-[1_1_200px] rounded-xl border border-line bg-page px-4 text-[16px] text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
        >
          {GOAL_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {goalChoiceLabel(choice)}
            </option>
          ))}
        </select>
        <Button data-testid="stats-goal-save" disabled={saving}>
          {saving ? 'Saving…' : 'Save goal'}
        </Button>
      </div>
      {saved !== null && (
        <Notice kind="success" data-testid="stats-goal-saved">
          {goalSavedLine(saved)}
        </Notice>
      )}
      {problem && (
        <Notice kind="error" data-testid="stats-goal-error">
          {GOAL_ERRORS[problem]}
        </Notice>
      )}
    </form>
  )
}
