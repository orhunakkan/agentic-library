import { useState } from 'react'
import type { SubscriptionView } from '~/shared/billing/billing'
import { MANAGE_BILLING, PORTAL_FAILED, paidLine, subscriptionStatusLine } from '~/shared/billing/copy'
import { Button, Notice } from '../account/ui'
import { openPortal } from './billing-client'

function ManageBilling() {
  const [state, setState] = useState<'idle' | 'opening' | 'failed'>('idle')
  const open = async () => {
    setState('opening')
    const result = await openPortal()
    if (result.ok) window.location.assign(result.value)
    else setState('failed')
  }
  return (
    <div className="mt-5">
      <Button
        type="button"
        variant="secondary"
        data-testid="pro-manage-billing"
        disabled={state === 'opening'}
        onClick={() => void open()}
      >
        {MANAGE_BILLING}
      </Button>
      {state === 'failed' && (
        <Notice kind="error" data-testid="pro-portal-error">
          {PORTAL_FAILED}
        </Notice>
      )}
    </div>
  )
}

export function PaidStatus({ subscription }: { subscription: SubscriptionView }) {
  const line = paidLine(subscription.cadence, subscription.founding)
  const status = subscriptionStatusLine(subscription)
  return (
    <div>
      <p className="text-[16px] text-ink" data-testid="plan-line">
        {line.before}
        <strong>{line.name}</strong>
        {line.after}
      </p>
      {status?.kind === 'warning' && (
        <Notice kind="warning" data-testid="plan-warning">
          {status.text}
        </Notice>
      )}
      {status?.kind === 'info' && (
        <p className="mt-2 text-[15px] text-body" data-testid="plan-status">
          {status.text}
        </p>
      )}
      <ManageBilling />
    </div>
  )
}
