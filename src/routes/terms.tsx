/**
 * These terms are agenticlibrary.app's own, written for the service Orhun Akkan runs there. If you run Folio for other
 * people, rewrite them for your own service before you open it: who runs it, its limits and its rules.
 */
import { createFileRoute, Link, useLoaderData } from '@tanstack/react-router'
import { Contact, LegalPage, legalHead, legalLink, Part } from '~/client/components/LegalPage'
import { SourceLink } from '~/client/features/legal/SourceLink'
import { getSiteContact } from '~/server/functions'
import { TERMS_UPDATED } from '~/shared/lib/site'

const TERMS_LEAD = 'The terms for using Folio at this site.'

export const Route = createFileRoute('/terms')({
  loader: () => getSiteContact(),
  head: () => legalHead('Terms', '/terms', TERMS_LEAD),
  component: TermsPage,
})

function TermsPage() {
  const contact = Route.useLoaderData()
  const { sourceUrl } = useLoaderData({ from: '__root__' })
  return (
    <LegalPage title="Terms" titleTestId="terms-title" lead={TERMS_LEAD} updated={TERMS_UPDATED}>
      <Part id="who" title="Who runs Folio">
        <p>
          Folio at agenticlibrary.app is run by Orhun Akkan as a free service. Folio’s code is open source under the MIT
          licence. These terms cover using this site, not the code, whose licence is in its{' '}
          <SourceLink sourceUrl={sourceUrl}>repository</SourceLink>.
        </p>
      </Part>

      <Part id="free" title="Free, with limits">
        <p>
          Folio costs nothing, and there’s no paid plan. Each account has storage limits, which the Storage section of
          your account page shows. They may change, and a lower limit never deletes what you already have.
        </p>
      </Part>

      <Part id="account" title="Your account">
        <p>
          You must be 16 or older. An account is for one person, so don’t share it or its password. Keep your email
          address one you can receive mail at.
        </p>
      </Part>

      <Part id="content" title="What you upload">
        <p>
          You keep every right you have in what you upload. You let Folio store it, show it to you, and send passages to
          the AI and voice providers you choose, only to run the features you use. Your uploads stay private to your
          account, and Folio doesn’t look at them, except as the{' '}
          <Link to="/copyright" className={legalLink} data-testid="terms-copyright-link">
            Copyright page
          </Link>{' '}
          describes.
        </p>
      </Part>

      <Part id="use" title="Using Folio">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Only upload books and audiobooks that are yours to upload, and articles you save for your own reading: ones
            you own or have the right to use.
          </li>
          <li>Don’t upload anything illegal, and don’t use Folio to harm anyone or to get around its limits.</li>
          <li>Don’t use Folio as general file storage.</li>
          <li>Don’t make accounts in bulk or by script.</li>
          <li>Don’t try to break or overload the service.</li>
          <li>Folio may close an account that abuses the service.</li>
        </ul>
      </Part>

      <Part id="copyright" title="Copyright">
        <p>
          Only upload what you have the right to. Folio removes books and articles named in a valid notice, and closes
          accounts that get repeated notices. The{' '}
          <Link to="/copyright" className={legalLink} data-testid="terms-copyright-link">
            Copyright page
          </Link>{' '}
          says how to send a notice and what happens next.
        </p>
      </Part>

      <Part id="providers" title="Your own API keys">
        <p>
          Ask the book, Translate and ElevenLabs voices run on your own API keys, under your own agreements with those
          providers.
        </p>
      </Part>

      <Part id="ending" title="Ending">
        <p>
          You can delete your account at any time, from your account page. Folio may close an account that breaks these
          terms. Where it can, Folio says why first and gives you time to download your data, but not for illegal
          content.
        </p>
        <p>
          If Folio ever closes, the site says so, and readers with an address are emailed, at least 30 days before, so
          you can download everything.
        </p>
      </Part>

      <Part id="warranty" title="No warranty">
        <p>
          Folio is provided as it is. It’s run with care, but it may sometimes be unavailable, and features may change.
          Keep your own copies of anything you can’t lose: you can download everything your account holds from your
          account page at any time.
        </p>
      </Part>

      <Part id="liability" title="Liability">
        <p>
          As far as the law allows, Folio isn’t liable for lost data or for indirect loss from using it. Nothing here
          limits liability that the law doesn’t let anyone limit.
        </p>
      </Part>

      <Part id="changes" title="Changes to these terms">
        <p>
          When these terms change, this page says so, with a new date at the top. A change that takes away something you
          rely on is announced on the site at least 14 days before it applies.
        </p>
      </Part>

      <Part id="contact" title="Questions">
        <p>
          Questions about these terms: <Contact contact={contact} />.
        </p>
      </Part>
    </LegalPage>
  )
}
