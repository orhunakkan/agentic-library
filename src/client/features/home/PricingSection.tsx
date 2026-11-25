import { Link } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Viewer } from '~/server/auth'
import type { BillingOffer } from '~/shared/billing/billing'
import { GO_PRO, HOME_PRICING_INTRO } from '~/shared/billing/copy'
import { FREE_LIMITS, PRO_FEATURES } from '~/shared/plans/plans'
import { formatPrice, PRO_PRICE, yearlySavingPercent } from '~/shared/plans/pricing'
import { FoundingBand } from '../billing/FoundingBand'
import { primaryButton } from './buttons'

const FREE_FEATURES = [
  'Every book in the library',
  'Read aloud with your device’s voices',
  'Light, sepia and dark pages',
  'Continue reading where you stopped, on any device',
  `Import ${FREE_LIMITS.books} of your own books`,
  `Up to ${FREE_LIMITS.highlights} highlights and notes`,
]

const PRO_CARD = ['Everything in Free', ...PRO_FEATURES.map((f) => f.label)]

function Plan({
  name,
  price,
  per,
  note,
  features,
  action,
  featured,
}: {
  name: string
  price: string
  per?: string
  note: string
  features: string[]
  action: ReactNode
  featured?: boolean
}) {
  return (
    <article
      className={
        featured
          ? 'flex flex-col rounded-2xl border-2 border-accent-line bg-surface p-6 sm:p-8'
          : 'flex flex-col rounded-2xl border border-line bg-surface p-6 sm:p-8'
      }
    >
      <h3 className="font-display text-[22px] font-bold text-ink">{name}</h3>
      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="font-display text-[44px] leading-none font-bold text-ink">{price}</span>
        {per && <span className="text-[15px] text-muted">{per}</span>}
      </p>
      <p className="mt-2 text-[15px] text-body">{note}</p>
      <div className="mt-6">{action}</div>
      <ul className="mt-6 flex flex-col gap-3 text-[15px] text-body">
        {features.map((f) => (
          <li key={f} className="flex gap-2.5">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
            {f}
          </li>
        ))}
      </ul>
    </article>
  )
}

function GoPro({ viewer }: { viewer: Viewer | null }) {
  const className = `${primaryButton()} w-full`
  if (viewer)
    return (
      <Link to="/account/plan" className={className} data-testid="pricing-go-pro">
        {GO_PRO}
      </Link>
    )
  return (
    <Link to="/login" search={{ next: '/account/plan' }} className={className} data-testid="pricing-go-pro">
      {GO_PRO}
    </Link>
  )
}

export function PricingSection({ viewer, offer }: { viewer: Viewer | null; offer: BillingOffer }) {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="mt-24 scroll-mt-20 sm:mt-32">
      <p className="text-[14px] font-semibold tracking-[0.14em] text-accent uppercase">Pricing</p>
      <h2
        id="pricing-title"
        className="mt-3 font-display text-[34px] leading-tight font-bold tracking-tight text-ink sm:text-[44px]"
      >
        {offer.on ? HOME_PRICING_INTRO : 'Free to read. Pro when you want more.'}
      </h2>
      <p className="mt-4 max-w-[640px] text-[17px] text-body">
        {offer.on
          ? 'Your library and read aloud stay free for everyone.'
          : 'Pro is coming soon. Your library and read aloud stay free for everyone.'}
      </p>
      {offer.on && <FoundingBand left={offer.foundingLeft} />}
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <Plan
          name="Free"
          price={formatPrice(0)}
          note="Everything you need to read, for good."
          features={FREE_FEATURES}
          action={
            <Link to="/library" className={`${primaryButton()} w-full`} data-testid="pricing-start-reading">
              Start reading
            </Link>
          }
        />
        <Plan
          featured
          name="Pro"
          price={formatPrice(PRO_PRICE.monthly)}
          per="a month"
          note={`or ${formatPrice(PRO_PRICE.yearly)} a year, about ${yearlySavingPercent()}% less`}
          features={PRO_CARD}
          action={
            offer.on ? (
              <GoPro viewer={viewer} />
            ) : (
              <p
                data-testid="pricing-coming-soon"
                className="flex h-12 items-center justify-center rounded-full border border-dashed border-accent-line text-[16px] font-semibold text-accent"
              >
                Coming soon
              </p>
            )
          }
        />
      </div>
      <p className="mt-6 max-w-[720px] text-[14px] text-muted">
        Ask the book sends your question and the pages you’ve read to Anthropic or OpenAI, whichever your chosen model
        is from, with your own key. They bill you for it; Folio adds no markup.
      </p>
    </section>
  )
}
