import type { Viewer } from '~/server/auth'
import type { BillingOffer } from '~/shared/billing/billing'
import { ClosingCall } from './ClosingCall'
import { Faq } from './Faq'
import { Features } from './Features'
import { Hero } from './Hero'
import { HomeFooter } from './HomeFooter'
import { HomeHeader } from './HomeHeader'
import { PricingSection } from './PricingSection'
import { ReaderPreview } from './ReaderPreview'
import { StorybookPanel } from './StorybookPanel'

export function HomePage({ viewer, offer }: { viewer: Viewer | null; offer: BillingOffer }) {
  return (
    <div id="top">
      <HomeHeader viewer={viewer} />
      <main id="main" className="page-wrap">
        <Hero viewer={viewer} billing={offer.on} />
        <ReaderPreview />
        <Features />
        <StorybookPanel />
        <PricingSection viewer={viewer} offer={offer} />
        <Faq billing={offer.on} />
        <ClosingCall viewer={viewer} />
      </main>
      <HomeFooter viewer={viewer} />
    </div>
  )
}
