import { createFileRoute } from '@tanstack/react-router'
import { Contact, LegalPage, legalHead, Part } from '~/client/components/LegalPage'
import { getSiteContact } from '~/server/functions'
import { TERMS_UPDATED } from '~/shared/lib/site'

const DESCRIPTION = 'The terms for using Folio.'

export const Route = createFileRoute('/terms')({
  loader: () => getSiteContact(),
  head: () => legalHead('Terms', '/terms', DESCRIPTION),
  component: TermsPage,
})

function TermsPage() {
  const contact = Route.useLoaderData()
  return (
    <LegalPage title="Terms" titleTestId="terms-title" lead={DESCRIPTION} updated={TERMS_UPDATED}>
      <Part id="who" title="Who you’re dealing with">
        <p>Folio is run by Orhun Akkan.</p>
      </Part>

      <Part id="api-keys" title="Your own API keys">
        <p>
          Ask the book, Translate and ElevenLabs voices run on your own API keys, under your own agreements with those
          providers, which bill you for what you use.
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
