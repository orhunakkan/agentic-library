import { initializePaddle, type PaddleEventData } from '@paddle/paddle-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BillingProblem, Cadence, PlanState } from '~/shared/billing/billing'
import { fetchPlanState, startCheckout } from './billing-client'
import { isStillConfirming, nextPollDelay } from './confirm-wait'

export type CheckoutPhase =
  | { kind: 'idle'; problem?: BillingProblem | 'network' }
  | { kind: 'opening' }
  | { kind: 'open' }
  | { kind: 'confirming'; still: boolean }
  | { kind: 'welcome' }

export function useCheckout(onPro: (state: PlanState) => void) {
  const [phase, setPhase] = useState<CheckoutPhase>({ kind: 'idle' })
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onProRef = useRef(onPro)
  onProRef.current = onPro

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const confirm = useCallback(() => {
    if (phaseRef.current.kind === 'confirming' || phaseRef.current.kind === 'welcome') return
    const started = Date.now()
    setPhase({ kind: 'confirming', still: false })
    const look = async () => {
      const state = await fetchPlanState()
      if (state?.plan === 'pro') {
        setPhase({ kind: 'welcome' })
        onProRef.current(state)
        return
      }
      const elapsed = Date.now() - started
      if (isStillConfirming(elapsed)) setPhase({ kind: 'confirming', still: true })
      timer.current = setTimeout(look, nextPollDelay(elapsed))
    }
    timer.current = setTimeout(look, nextPollDelay(0))
  }, [])

  const onEvent = useCallback(
    (event: PaddleEventData) => {
      if (event.name === 'checkout.completed') confirm()
      else if (event.name === 'checkout.closed' && phaseRef.current.kind === 'open') setPhase({ kind: 'idle' })
    },
    [confirm],
  )

  const buy = useCallback(
    async (cadence: Cadence) => {
      setPhase({ kind: 'opening' })
      const result = await startCheckout(cadence)
      if (!result.ok) {
        setPhase({ kind: 'idle', problem: result.problem })
        return
      }
      const { transactionId, clientToken, env, email } = result.value
      try {
        const paddle = await initializePaddle({ token: clientToken, environment: env, eventCallback: onEvent })
        if (!paddle) throw new Error('Paddle.js didn’t load')
        setPhase({ kind: 'open' })
        paddle.Checkout.open({
          transactionId,
          ...(email ? { customer: { email } } : {}),
          settings: { displayMode: 'overlay' },
        })
      } catch {
        setPhase({ kind: 'idle', problem: 'failed' })
      }
    },
    [onEvent],
  )

  return { phase, buy }
}
