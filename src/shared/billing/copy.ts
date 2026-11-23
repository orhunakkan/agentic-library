import { shortDate } from '../lib/site.ts'
import { formatPrice, PRO_PRICE, yearlySavingPercent } from '../plans/pricing.ts'
import { type BillingProblem, type Cadence, FOUNDING_LIMIT, priceOf, type SubscriptionView } from './billing.ts'

export const PRO_PAGE_TITLE = 'Folio Pro'

export const COMING_SOON = 'Pro is coming soon.'

export function cadenceName(cadence: Cadence, founding: boolean): string {
  if (cadence === 'month') return 'monthly'
  return founding ? 'founding yearly' : 'yearly'
}

export function paidLine(cadence: Cadence, founding: boolean): { before: string; name: 'Pro'; after: string } {
  return { before: 'You’re on ', name: 'Pro', after: `, ${cadenceName(cadence, founding)}.` }
}

export function subscriptionStatusLine(sub: SubscriptionView): { kind: 'info' | 'warning'; text: string } | null {
  if (sub.status === 'past_due')
    return {
      kind: 'warning',
      text: 'Your last payment didn’t go through. Paddle will try again; update your card in Manage billing to keep Pro.',
    }
  if (sub.cancelAt) return { kind: 'info', text: `Ends on ${shortDate(sub.cancelAt)}. You keep Pro until then.` }
  if (sub.periodEndsAt)
    return {
      kind: 'info',
      text: `Renews on ${shortDate(sub.periodEndsAt)} for ${formatPrice(priceOf(sub.cadence, sub.founding))}.`,
    }
  return null
}

export function endedLine(endedAt: string): string {
  return `Your Pro subscription ended on ${shortDate(endedAt)}.`
}

export const MANAGE_BILLING = 'Manage billing'

export const CADENCE_CHOICES: readonly { cadence: Cadence; label: string }[] = [
  { cadence: 'year', label: 'Yearly' },
  { cadence: 'month', label: 'Monthly' },
]

export function offerLine(
  cadence: Cadence,
  foundingLeft: number,
): { price: string; rest: string; struck: string | null } {
  if (cadence === 'month') return { price: formatPrice(PRO_PRICE.monthly), rest: ' a month', struck: null }
  if (foundingLeft > 0)
    return {
      price: formatPrice(priceOf('year', true)),
      rest: ` a year. Founding member price: yours for as long as you stay subscribed. ${foundingLeft} of ${FOUNDING_LIMIT} left.`,
      struck: formatPrice(PRO_PRICE.yearly),
    }
  return {
    price: formatPrice(PRO_PRICE.yearly),
    rest: ` a year, about ${yearlySavingPercent()}% less than monthly`,
    struck: null,
  }
}

export function buyLabel(cadence: Cadence, founding: boolean): string {
  return `Go Pro, ${formatPrice(priceOf(cadence, founding))} a ${cadence}`
}

export const OPENING_CHECKOUT = 'Opening checkout…'

export const PAYMENT_NOTE =
  'Paddle handles the payment as Folio’s reseller, so the charge comes from Paddle. Prices include tax. Cancel any time in Manage billing; you keep Pro until the end of what you paid for.'

export const CONFIRMING = 'Payment received. Turning on Pro…'
export const STILL_CONFIRMING = 'Paddle is still confirming your payment. This page updates when it does.'
export const WELCOME = { heading: 'Welcome to Pro.', sentence: 'Everything is on.' } as const
export const BACK_TO_READING = 'Back to reading'

export function billingProblemText(problem: BillingProblem | 'network'): string {
  switch (problem) {
    case 'subscribed':
    case 'pro':
      return 'You already have Pro.'
    case 'signed_out':
      return 'Your session has ended. Sign in again.'
    case 'not_found':
      return 'There’s no subscription to manage on this account.'
    case 'invalid':
    case 'failed':
    case 'network':
      return 'Couldn’t open the checkout. Try again in a moment.'
  }
}

export const PORTAL_FAILED = 'Couldn’t open Manage billing. Try again in a moment.'

export const DELETE_CANCELS_PRO = 'Your Pro subscription is cancelled with it, at once.'

export const DELETE_BILLING_FAILED =
  'Couldn’t cancel your Pro subscription, so your account wasn’t deleted. Try again, or cancel it in Manage billing first.'

export const HOME_HERO_LINE = `Free to read. Pro is ${formatPrice(PRO_PRICE.monthly)} a month or ${formatPrice(PRO_PRICE.yearly)} a year.`
export const HOME_PRICING_INTRO = 'Free to read, for good. Pro when you want more.'
export const GO_PRO = 'Go Pro'

export function foundingBand(left: number): { strong: string; rest: string } | null {
  if (left <= 0) return null
  return {
    strong: `Founding members: ${formatPrice(priceOf('year', true))} a year`,
    rest: `, for as long as you stay subscribed. ${left} of the first ${FOUNDING_LIMIT} left.`,
  }
}

export const PAYING_QUESTIONS: readonly { q: string; a: string }[] = [
  {
    q: 'How does paying work?',
    a: 'Paddle sells Pro for Folio and handles the payment, tax and receipts. You can cancel any time in Manage billing and keep Pro until the end of what you paid for. A payment can be refunded within 14 days.',
  },
  {
    q: 'What happens if I stop paying?',
    a: 'You go back to Free. Nothing you made is deleted; you just can’t add more than Free allows.',
  },
]
