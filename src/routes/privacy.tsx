import { createFileRoute, Link } from '@tanstack/react-router'
import { Contact, LegalPage, legalLink, Part } from '~/client/components/LegalPage'
import { getSiteContact } from '~/server/functions'
import { PRIVACY_UPDATED, SITE_NAME } from '~/shared/lib/site'

const DESCRIPTION = 'What Folio keeps about you, why, and for how long.'

export const Route = createFileRoute('/privacy')({
  loader: () => getSiteContact(),
  head: () => ({
    meta: [
      { title: `Privacy | ${SITE_NAME}` },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:title', content: `Privacy | ${SITE_NAME}` },
      { property: 'og:description', content: DESCRIPTION },
    ],
    links: [{ rel: 'canonical', href: '/privacy' }],
  }),
  component: PrivacyPage,
})

function PrivacyPage() {
  const contact = Route.useLoaderData()
  return (
    <LegalPage
      title="Privacy"
      titleTestId="privacy-title"
      lead="What Folio keeps about you, why, and for how long."
      updated={PRIVACY_UPDATED}
    >
      <Part id="without-account" title="Reading without an account">
        <p>
          Reading and listening need no account and set no cookie. Your settings, reading places, Ask threads and
          listening positions are kept in this browser’s storage, on your device. Folio’s server doesn’t receive them.
        </p>
        <p>
          Books you download stay in this browser until you remove them. Your own books’ downloads are deleted when you
          sign out, and after 30 days without a connection.
        </p>
        <p>
          If you download the Folio voice, its files come from Folio’s own server and stay in this browser until you
          remove them from the Voice menu. It speaks on your device: the text it reads isn’t sent anywhere.
        </p>
        <p>
          Every request passes through Cloudflare, which carries the site to Folio’s server. The server’s access log
          records your IP address and the page you asked for, and keeps them for up to 14 days.
        </p>
      </Part>

      <Part id="with-account" title="With an account">
        <p>
          Your account holds your username, a hash of your password (Folio can’t read the password itself) and, if you
          add one, the email address you confirmed. It also holds what you add: your own books, highlights, notes,
          bookmarks, saved flashcards (the card’s text and the page it came from), the prompts you save for Ask the book
          (each one’s name and text), shelves, the stars you gave books (nobody else ever sees them, and deleting a book
          you imported, or your account, deletes them), the books you removed from your library, reading and listening
          places, reader settings and the AI and voice models you chose. It holds your plan too, and if an admin gave
          you Pro, when and which admin. An API key you save is kept encrypted, and is never shown or sent back to your
          browser.
        </p>
        <p>
          If you add a passkey, Folio keeps its public key, its credential id, a name for it, when you added it and last
          used it, and whether it’s synced between your devices. Never your fingerprint, face or PIN: those stay on your
          device, which only tells Folio it checked them. Resetting your password removes every passkey.
        </p>
        <p>
          If you add GitHub repositories, Folio keeps which ones (their owner, name and the branch or tag you named),
          when you added and last opened each, and which commit it shows you. It never keeps a repository’s files: they
          come from GitHub each time, and are held only in the server’s memory for a while.
        </p>
        <p>
          While you’re signed in, Folio counts the time you spend reading and listening for your reading stats: how many
          seconds in each stretch of reading or listening, and on which day, never which book or page. It also keeps the
          books you finished and when, your daily goals, and your device’s time zone, to know which day is today for
          you. They’re in your data’s download, they’re deleted with your account, and nobody else sees them.
        </p>
        <p>
          If you buy Pro, Folio keeps your subscription’s status, plan (monthly, yearly or founding) and dates, with
          Paddle’s ids for it and for you as its customer. When you delete your account, the subscription is cancelled
          and the ids that tie it to you are deleted; the rest stays, without your account, so the count of founding
          subscriptions stays right.
        </p>
        <p>To keep accounts safe, Folio keeps:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>your sessions, with their device, IP address and last activity, until they end (30 days at most);</li>
          <li>
            the access tokens you make for scripts or test clients, with the name you gave each, the device and IP
            address that made it and when it was last used, until it ends (30 days at most), never the token itself;
          </li>
          <li>sign-in attempts, with the IP address, for 30 days;</li>
          <li>
            an activity log of events such as signing in, changing your password or address, importing a book or asking
            a question, with the IP address, for a year. It records counts and outcomes, never your text, a book’s
            contents or a password;
          </li>
          <li>
            if you read aloud with an ElevenLabs voice, how many characters it spoke on your key each minute, with no
            text, for 31 days, to keep to an hourly limit and show your usage.
          </li>
        </ul>
        <p>
          Audiobooks you import are uploaded and kept on Folio’s server for you alone: only your account can play them.
          They’re deleted at once with the audiobook or your account, and they aren’t in Folio’s backups, so keep your
          own copy.
        </p>
        <p>Signed in, Folio sets one cookie, which keeps you signed in. It has no other cookies.</p>
        <p>If you ask for a sign-up link and don’t finish, the address is deleted after 7 days.</p>
      </Part>

      <Part id="who-else" title="Who else sees it">
        <p>Resend sends Folio’s mail, so it receives your address and the message.</p>
        <p>
          If you buy Pro, Paddle sells it for Folio and takes the payment: it receives your payment details and the
          address and country you pay with, under its own privacy notice. Folio never sees your card. Paddle tells Folio
          when your subscription starts, renews, fails to renew or ends.
        </p>
        <p>
          When you use Ask the book, Explain, summaries, recaps, quizzes, flashcards, one of your saved prompts or
          Translate, the passages, your question, the prompt’s text and any highlights sent with it go to Anthropic or
          OpenAI, whichever your chosen model is from, on your own API key and under your own agreement with that
          provider. Folio asks OpenAI not to store them. Folio doesn’t log your questions or prompts.
        </p>
        <p>
          When you look up a book’s details or a word, Folio’s server asks Open Library, Wiktionary or Wikipedia for the
          title, ISBN or word. Your IP address isn’t sent to them.
        </p>
        <p>
          When you add or read a GitHub repository, Folio’s server asks GitHub for it: the names of the repository and
          of the files and folders you open. Your browser never asks GitHub, so GitHub doesn’t see you, except for the
          pictures from other sites you choose to show in a file, which your browser loads from those sites.
        </p>
        <p>
          When you save an article, Folio’s server fetches the page and its pictures from the site, so the site sees
          Folio, not you. Folio keeps the article’s text, its pictures and its address as one of your private books,
          until you delete it.
        </p>
        <p>
          Read aloud uses your device’s voices, or the Folio voice if you download it, which speaks on your device.
          Online voices, which are labelled, send the text to their maker to be spoken. If you pick an ElevenLabs voice,
          Folio’s server sends ElevenLabs the sentence being read, with the sentences around it, on your own API key,
          under your own agreement with ElevenLabs. Folio never picks one for you.
        </p>
        <p>
          If you ask by voice, your browser turns your speech into text. In Chrome and Firefox it does that on your
          device when it can. Otherwise, and only after you agree, your browser’s maker (Google, Apple or Microsoft)
          receives the audio to do it. Folio receives only the text, as if you had typed it. Answers are read aloud by
          your device.
        </p>
        <p>Nothing is sold. There are no ads, analytics or trackers.</p>
      </Part>

      <Part id="choices" title="Your choices">
        <p>
          From your{' '}
          <Link to="/account" className={legalLink} data-testid="privacy-account-link">
            account page
          </Link>{' '}
          you can download everything your account holds, change or remove your email address, add or remove passkeys,
          sign out other devices, and delete your account. Deleting it removes everything in it at once. The activity
          log keeps a record of the deletion, with your username, until that record is a year old.
        </p>
        <p>
          Folio has no backups yet, so a deletion can’t be undone. Once nightly backups run, they keep a copy for up to
          14 days.
        </p>
      </Part>

      <Part id="children" title="Children">
        <p>Folio isn’t meant for children under 16.</p>
      </Part>

      <Part id="questions" title="Questions">
        <p>
          Folio is run by Orhun Akkan. Questions about your data: <Contact contact={contact} />.
        </p>
      </Part>
    </LegalPage>
  )
}
