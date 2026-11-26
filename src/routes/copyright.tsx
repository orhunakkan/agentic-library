/**
 * This page is agenticlibrary.app's own, written for the service Orhun Akkan runs there. If you run Folio for other
 * people, rewrite it for your own service: how you take notices, and what you do with them.
 */
import { createFileRoute, Link, useLoaderData } from '@tanstack/react-router'
import { Contact, LegalPage, legalHead, legalLink, Part } from '~/client/components/LegalPage'
import { SourceLink } from '~/client/features/legal/SourceLink'
import { getSiteContact } from '~/server/functions'
import { COPYRIGHT_UPDATED } from '~/shared/lib/site'

const COPYRIGHT_LEAD =
  'How to report a book or article on Folio that you think infringes your copyright, and what happens next.'

export const Route = createFileRoute('/copyright')({
  loader: () => getSiteContact(),
  head: () => legalHead('Copyright', '/copyright', COPYRIGHT_LEAD),
  component: CopyrightPage,
})

/** What a complete notice holds: enough for a US DMCA notice and an EU Digital Services Act notice alike. */
const NOTICE_ELEMENTS = [
  { key: 'who', text: 'your name, and how to reach you;' },
  { key: 'work', text: 'the work you own;' },
  {
    key: 'copy',
    text: 'what on Folio you believe copies it, such as the title and author as uploaded, the username or the article’s address: whatever you know;',
  },
  {
    key: 'good-faith',
    text: 'a statement that you believe in good faith that the use isn’t allowed by you, your agent or the law;',
  },
  {
    key: 'accurate',
    text: 'a statement that the notice is accurate, and that you own the right or may act for its owner;',
  },
  { key: 'signature', text: 'your signature, which can be your typed name.' },
]

function CopyrightPage() {
  const contact = Route.useLoaderData()
  const { sourceUrl } = useLoaderData({ from: '__root__' })
  return (
    <LegalPage title="Copyright" titleTestId="copyright-title" lead={COPYRIGHT_LEAD} updated={COPYRIGHT_UPDATED}>
      <Part id="what" title="What’s on Folio">
        <p>
          Readers upload books, audiobooks and articles to their own private library. Nobody else can see them, and
          Folio doesn’t review uploads.
        </p>
      </Part>

      <Part id="notice" title="Sending a notice">
        <p>
          Write to <Contact contact={contact} /> with:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          {NOTICE_ELEMENTS.map((element) => (
            <li key={element.key} data-testid="copyright-notice-element" data-key={element.key}>
              {element.text}
            </li>
          ))}
        </ul>
      </Part>

      <Part id="next" title="What Folio does">
        <p>
          Folio replies to say it got the notice. If the notice is complete, Folio removes what it names, and tells the
          reader who uploaded it what was removed, why, and who sent the notice. Removal deletes the copy on Folio, and
          the reader still has their own file.
        </p>
        <p>An incomplete notice gets a reply saying what’s missing.</p>
      </Part>

      <Part id="mistake" title="If yours was removed by mistake">
        <p>
          Reply to Folio’s message saying why. Folio passes it to the sender. If the sender withdraws, or the matter
          ends in your favour, you may upload the book again.
        </p>
      </Part>

      <Part id="repeat" title="Repeated notices">
        <p>Folio closes an account after its third valid notice.</p>
      </Part>

      <Part id="false" title="False notices">
        <p>Knowingly sending a false notice or reply may make you liable for the harm it causes.</p>
      </Part>

      <Part id="other" title="Other illegal content">
        <p>
          Report anything else you believe is illegal to the same contact, saying what it is and why. Folio handles it
          the same way.
        </p>
      </Part>

      <Part id="code" title="Folio’s own code and voices">
        <p>
          This page is about uploads. Folio’s code and the parts it uses are credited on{' '}
          <Link to="/credits" className={legalLink} data-testid="copyright-credits-link">
            Credits
          </Link>
          , and in the <SourceLink sourceUrl={sourceUrl}>source repository</SourceLink>.
        </p>
      </Part>
    </LegalPage>
  )
}
