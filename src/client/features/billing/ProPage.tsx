import { Link } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { legalLink } from '~/client/components/LegalPage'
import { cn } from '~/client/lib/cn'
import type { Cadence, PlanState } from '~/shared/billing/billing'
import {
  BACK_TO_READING,
  billingProblemText,
  buyLabel,
  CADENCE_CHOICES,
  COMING_SOON,
  CONFIRMING,
  endedLine,
  OPENING_CHECKOUT,
  offerLine,
  PAYMENT_NOTE,
  STILL_CONFIRMING,
  WELCOME,
} from '~/shared/billing/copy'
import { planLine } from '~/shared/plans/copy'
import { PRO_FEATURES } from '~/shared/plans/plans'
import { Button, Notice } from '../account/ui'
import { readRecent } from '../reader/continue-reading'
import { PaidStatus, PlanLine } from './PaidStatus'
import { useCheckout } from './use-checkout'

function LegalLinks({ className }: { className: string }) {
  return (
    <p className={cn('text-[14px] text-muted', className)}>
      <Link to="/terms" className={legalLink} data-testid="pro-terms">
        Terms
      </Link>
      {' · '}
      <Link to="/refunds" className={legalLink} data-testid="pro-refunds">
        Refunds
      </Link>
      {' · '}
      <Link to="/privacy" className={legalLink} data-testid="pro-privacy">
        Privacy
      </Link>
    </p>
  )
}

function Features() {
  return (
    <ul className="mt-5 flex flex-col gap-2.5 text-[15px] text-body">
      {PRO_FEATURES.map((f) => (
        <li key={f.label} className="flex gap-2.5">
          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
          {f.label}
        </li>
      ))}
    </ul>
  )
}

function CadenceSwitch({ value, onChange }: { value: Cadence; onChange: (cadence: Cadence) => void }) {
  const name = useId()
  return (
    <fieldset className="mt-6">
      <legend className="sr-only">Billing period</legend>
      <div className="inline-flex rounded-full border border-line bg-page p-1">
        {CADENCE_CHOICES.map((choice) => (
          <label
            key={choice.cadence}
            className="relative inline-flex h-10 cursor-pointer items-center rounded-full px-5 text-[15px] font-semibold text-muted has-checked:bg-accent-fill has-checked:text-on-accent has-focus-visible:ring-4 has-focus-visible:ring-accent/25"
          >
            <input
              type="radio"
              name={name}
              value={choice.cadence}
              data-testid="pro-cadence"
              data-key={choice.cadence}
              checked={value === choice.cadence}
              onChange={() => onChange(choice.cadence)}
              className="sr-only"
            />
            {choice.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Welcome() {
  const [href, setHref] = useState('/library')
  useEffect(() => setHref(readRecent()[0]?.href ?? '/library'), [])
  return (
    <div className="mb-6 rounded-[22px] border border-line bg-surface p-6" role="status" data-testid="pro-welcome">
      <p className="font-display text-[24px] font-bold text-ink">{WELCOME.heading}</p>
      <p className="mt-2 text-[16px] text-body">{WELCOME.sentence}</p>
      <a
        href={href}
        data-testid="pro-back-to-reading"
        className="mt-5 inline-flex h-12 items-center rounded-xl bg-accent-fill px-5 font-semibold text-on-accent"
      >
        {BACK_TO_READING}
      </a>
    </div>
  )
}

function BuyPro({ state, onPro }: { state: PlanState; onPro: (state: PlanState) => void }) {
  const [cadence, setCadence] = useState<Cadence>('year')
  const { phase, buy } = useCheckout(onPro)
  const founding = cadence === 'year' && state.foundingLeft > 0
  const offer = offerLine(cadence, state.foundingLeft)
  const busy = phase.kind === 'opening' || phase.kind === 'open' || phase.kind === 'confirming'
  return (
    <>
      {state.subscription?.endedAt && (
        <p className="mt-6 text-[15px] text-muted" data-testid="pro-ended">
          {endedLine(state.subscription.endedAt)}
        </p>
      )}
      <CadenceSwitch value={cadence} onChange={setCadence} />
      <article className="mt-5 rounded-2xl border-2 border-accent-line bg-surface p-6 sm:p-8">
        <h2 className="font-display text-[22px] font-bold text-ink">Pro</h2>
        <p className="mt-3 text-[16px] text-body" data-testid="pro-offer">
          {offer.struck && (
            <>
              <s className="text-muted">{offer.struck}</s>{' '}
            </>
          )}
          <strong className="font-display text-[32px] leading-none font-bold text-ink">{offer.price}</strong>
          {offer.rest}
        </p>
        <Features />
        <div className="mt-6">
          <Button
            type="button"
            data-testid="pro-buy"
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={() => void buy(cadence)}
          >
            {phase.kind === 'opening' ? OPENING_CHECKOUT : buyLabel(cadence, founding)}
          </Button>
          {phase.kind === 'idle' && phase.problem && (
            <Notice kind="error" id="checkout-error" data-testid="pro-checkout-error">
              {billingProblemText(phase.problem)}
            </Notice>
          )}
          {phase.kind === 'confirming' && (
            <p role="status" className="mt-4 text-[15px] text-body" data-testid="pro-confirming">
              {phase.still ? STILL_CONFIRMING : CONFIRMING}
            </p>
          )}
        </div>
        <p className="mt-6 text-[14px] leading-relaxed text-muted">{PAYMENT_NOTE}</p>
        <LegalLinks className="mt-3" />
      </article>
    </>
  )
}

export function ProPage({ initial }: { initial: PlanState }) {
  const [state, setState] = useState(initial)
  const [welcome, setWelcome] = useState(false)
  const turnedPro = (next: PlanState) => {
    setState(next)
    setWelcome(true)
  }
  if (!state.billing) {
    return (
      <>
        <p className="mt-6 text-[17px] text-body" data-testid="pro-coming-soon">
          {COMING_SOON}
        </p>
        <article className="mt-5 rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <h2 className="font-display text-[22px] font-bold text-ink">Pro</h2>
          <Features />
        </article>
        <LegalLinks className="mt-6" />
      </>
    )
  }
  if (state.plan === 'pro' && state.source === 'paid' && state.subscription) {
    return (
      <div className="mt-6">
        {welcome && <Welcome />}
        <PaidStatus subscription={state.subscription} />
        <LegalLinks className="mt-6" />
      </div>
    )
  }
  if (state.plan !== 'pro') return <BuyPro state={state} onPro={turnedPro} />
  if (welcome) return <Welcome />
  return <PlanLine line={planLine(state.source)} className="mt-6 text-[16px] text-ink" />
}
