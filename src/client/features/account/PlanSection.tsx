import { Link } from '@tanstack/react-router'
import type { SubscriptionView } from '~/shared/billing/billing'
import { GO_PRO } from '~/shared/billing/copy'
import { planLine, usageLine } from '~/shared/plans/copy'
import { FREE_LIMITS, limitsFor, type Plan, type PlanSource, PRO_FEATURES } from '~/shared/plans/plans'
import { PaidStatus } from '../billing/PaidStatus'
import { Section } from './ui'

export interface PlanView {
  plan: Plan
  source: PlanSource
  bookCount: number
  highlightCount: number
  subscription: SubscriptionView | null
}

function Usage({
  id,
  testId,
  line,
  used,
  max,
}: {
  id: string
  testId: string
  line: string
  used: number
  max: number
}) {
  return (
    <div className="space-y-1.5">
      <p id={id} className="text-[14.5px] text-ink" data-testid={testId}>
        {line}
      </p>
      <meter aria-labelledby={id} min={0} max={max} value={Math.min(used, max)} className="h-2 w-full max-w-[360px]" />
    </div>
  )
}

export function PlanSection({ plan }: { plan: PlanView }) {
  const line = planLine(plan.source)
  const books = limitsFor(plan.plan).books
  return (
    <Section id="plan" title="Plan">
      <div className="space-y-5">
        {plan.source === 'paid' && plan.subscription ? (
          <PaidStatus subscription={plan.subscription} />
        ) : (
          <p className="text-[14.5px] text-ink" data-testid="plan-line">
            {line.before}
            <strong>{line.name}</strong>
            {line.after}
          </p>
        )}
        {plan.source !== 'admin' && (
          <Usage
            id="plan-books"
            testId="account-plan-books"
            line={usageLine('books', plan.bookCount, books, plan.plan)}
            used={plan.bookCount}
            max={books}
          />
        )}
        {plan.plan === 'free' && (
          <>
            <Usage
              id="plan-highlights"
              testId="account-plan-highlights"
              line={usageLine('highlights', plan.highlightCount, FREE_LIMITS.highlights, 'free')}
              used={plan.highlightCount}
              max={FREE_LIMITS.highlights}
            />
            <div className="text-[14.5px]">
              <p className="font-semibold text-ink">Pro adds:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-body">
                {PRO_FEATURES.map((f) => (
                  <li key={f.label}>{f.label}</li>
                ))}
              </ul>
              <p className="mt-3">
                <Link
                  to="/account/plan"
                  data-testid="account-go-pro"
                  className="font-semibold text-accent underline-offset-2 hover:underline"
                >
                  {GO_PRO}
                </Link>
              </p>
            </div>
          </>
        )}
      </div>
    </Section>
  )
}
