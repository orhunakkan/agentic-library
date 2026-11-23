import { createFileRoute, Link } from '@tanstack/react-router'
import { Contact, LegalPage, legalLink, Part } from '~/client/components/LegalPage'
import { getSiteContact } from '~/server/functions'
import { FOUNDING_LIMIT } from '~/shared/billing/billing'
import { SITE_NAME, TERMS_UPDATED } from '~/shared/lib/site'
import { FREE_LIMITS, PRO_FEATURES } from '~/shared/plans/plans'
import { FOUNDING_PRICE, formatPrice, PRO_PRICE } from '~/shared/plans/pricing'

const DESCRIPTION = 'The terms for using Folio, and for buying Folio Pro.'

export const Route = createFileRoute('/terms')({
  loader: () => getSiteContact(),
  head: () => ({
    meta: [
      { title: `Terms | ${SITE_NAME}` },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:title', content: `Terms | ${SITE_NAME}` },
      { property: 'og:description', content: DESCRIPTION },
    ],
    links: [{ rel: 'canonical', href: '/terms' }],
  }),
  component: TermsPage,
})

function TermsPage() {
  const contact = Route.useLoaderData()
  return (
    <LegalPage
      title="Terms"
      titleTestId="terms-title"
      lead="The terms for using Folio, and for buying Folio Pro."
      updated={TERMS_UPDATED}
    >
      <Part id="who" title="Who you’re dealing with">
        <p>
          Folio is run by Orhun Akkan. Folio Pro is sold through Paddle (Paddle.com), which acts as the reseller: Paddle
          takes the payment, charges any sales tax or VAT, sends your receipts and handles refunds, under Paddle’s own
          buyer terms. Your charge comes from Paddle. Folio never sees your card.
        </p>
      </Part>

      <Part id="plans" title="Free and Pro">
        <p>
          Free costs nothing and doesn’t run out. It includes every book in the library, read aloud with your device’s
          voices, {FREE_LIMITS.books} of your own books, {FREE_LIMITS.highlights} highlights and notes, and{' '}
          {FREE_LIMITS.articles} saved articles.
        </p>
        <p>Pro adds:</p>
        <ul className="list-disc space-y-1 pl-6">
          {PRO_FEATURES.map((f) => (
            <li key={f.label}>{f.label}</li>
          ))}
        </ul>
        <p>
          Ask the book, Translate and ElevenLabs voices run on your own API keys, under your own agreements with those
          providers, which bill you for what you use.
        </p>
      </Part>

      <Part id="paying" title="Paying for Pro">
        <p>
          Pro is {formatPrice(PRO_PRICE.monthly)} a month or {formatPrice(PRO_PRICE.yearly)} a year, tax included. The
          first {FOUNDING_LIMIT} yearly subscribers pay {formatPrice(FOUNDING_PRICE)} a year instead, for as long as
          that subscription lasts; if you cancel and subscribe again, you pay the regular price.
        </p>
        <p>
          Pro renews at the end of each month or year, at the price you subscribed at, until you cancel. You can cancel
          any time from Manage billing on your{' '}
          <Link to="/account/plan" className={legalLink} data-testid="terms-plan-link">
            Pro page
          </Link>
          . You keep Pro until the end of the time you paid for, then your account goes back to Free. Nothing you made
          is deleted; you just can’t add more than Free allows. Refunds are on the{' '}
          <Link to="/refunds" className={legalLink} data-testid="terms-refunds-link">
            Refunds
          </Link>{' '}
          page.
        </p>
        <p>
          If a renewal payment fails, Paddle tries again for up to 30 days, and you keep Pro meanwhile. If it never goes
          through, the subscription ends.
        </p>
      </Part>

      <Part id="use" title="Using Folio">
        <ul className="list-disc space-y-2 pl-6">
          <li>An account is for one person. Don’t share it, or your password.</li>
          <li>
            Only upload books and audiobooks that are yours to upload, and articles you save for your own reading: ones
            you own or have the right to use. Your own books and articles stay private to your account.
          </li>
          <li>Don’t upload anything illegal, and don’t use Folio to harm anyone or to get around its limits.</li>
          <li>Folio may close an account that abuses the service.</li>
        </ul>
      </Part>

      <Part id="warranty" title="No warranty">
        <p>
          Folio is provided as it is. It’s run with care, but it may sometimes be unavailable, and features may change.
          Keep your own copies of anything you can’t lose: you can download everything your account holds from your
          account page at any time.
        </p>
      </Part>

      <Part id="changes" title="Changes to these terms">
        <p>When these terms change, this page says so, with a new date at the top.</p>
      </Part>

      <Part id="contact" title="Questions">
        <p>
          Questions about these terms: <Contact contact={contact} />.
        </p>
      </Part>
    </LegalPage>
  )
}
