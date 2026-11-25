import { createFileRoute, Link } from '@tanstack/react-router'
import { Contact, LegalPage, legalHead, legalLink, Part } from '~/client/components/LegalPage'
import { getSiteContact } from '~/server/functions'
import { REFUNDS_UPDATED } from '~/shared/lib/site'

const DESCRIPTION = 'How to get your money back for Folio Pro.'

export const Route = createFileRoute('/refunds')({
  loader: () => getSiteContact(),
  head: () => legalHead('Refunds', '/refunds', DESCRIPTION),
  component: RefundsPage,
})

function RefundsPage() {
  const contact = Route.useLoaderData()
  return (
    <LegalPage title="Refunds" titleTestId="refunds-title" lead={DESCRIPTION} updated={REFUNDS_UPDATED}>
      <Part id="window" title="14 days, in full">
        <p>
          You can have any Pro payment refunded in full within 14 days of it, whether it’s your first payment or a
          renewal. You don’t need to give a reason.
        </p>
      </Part>

      <Part id="how" title="How to ask">
        <p>
          Open Manage billing on your{' '}
          <Link to="/account/plan" className={legalLink} data-testid="refunds-plan-link">
            Pro page
          </Link>
          , or use the link in the receipt Paddle emailed you. Paddle, which sells Pro for Folio, processes every refund
          and sends the money back to the way you paid.
        </p>
        <p>
          A refund that ends your subscription ends Pro, and your account goes back to Free. Nothing you made is
          deleted.
        </p>
      </Part>

      <Part id="cancelling" title="Cancelling">
        <p>
          Cancelling stops the next renewal. You keep Pro until the end of the time you paid for, and you aren’t charged
          again.
        </p>
      </Part>

      <Part id="contact" title="Questions">
        <p>
          Questions about a payment: <Contact contact={contact} />.
        </p>
      </Part>
    </LegalPage>
  )
}
