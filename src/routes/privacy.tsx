/**
 * This page is agenticlibrary.app's own, written for the service Orhun Akkan runs there: Cloudflare, Resend, the
 * server's 14-day access log and its backups are facts about that site, not about the code. If you run Folio for other
 * people, rewrite it for your own service before you open it.
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { Contact, LegalPage, legalHead, legalLink, Part } from '~/client/components/LegalPage'
import { getSiteContact } from '~/server/functions'
import { PRIVACY_UPDATED } from '~/shared/lib/site'

const DESCRIPTION = 'What Folio keeps about you, why, and for how long.'

export const Route = createFileRoute('/privacy')({
  loader: () => getSiteContact(),
  head: () => legalHead('Privacy', '/privacy', DESCRIPTION),
  component: PrivacyPage,
})

function PrivacyPage() {
  const contact = Route.useLoaderData()
  return (
    <LegalPage title="Privacy" titleTestId="privacy-title" lead={DESCRIPTION} updated={PRIVACY_UPDATED}>
      <Part id="visiting" title="Visiting Folio">
        <p>
          Folio sets no cookie before you sign in. Your settings and reading places are kept in this browser’s storage,
          on your device, and Folio’s server doesn’t receive them until you sign in and they’re saved to your account.
        </p>
        <p>
          Every request passes through Cloudflare, which carries the site to Folio’s server. The server’s access log
          records your IP address and the page you asked for, and keeps them for up to 14 days.
        </p>
        <p>
          Books you download stay in this browser until you remove them. Your own books’ downloads are deleted when you
          sign out, and after 30 days without a connection.
        </p>
        <p>
          GitHub repositories you download stay in this browser until you remove them. They’re deleted when you sign
          out, when you remove the repository from your account, and after 30 days without a connection.
        </p>
        <p>
          If you download the Folio voice, its files come from Folio’s own server and stay in this browser until you
          remove them from the Voice menu. It speaks on your device: the text of the book you open isn’t sent anywhere.
        </p>
      </Part>

      <Part id="with-account" title="With an account">
        <p>
          Signing up on this site needs an email address, which Folio confirms by sending you a link. If you ask for a
          sign-up link and don’t finish, the address is deleted after 7 days.
        </p>
        <p>
          Your account holds your username, a hash of your password (Folio can’t read the password itself) and, if you
          add one, the email address you confirmed. It also holds what you add: your own books, highlights, notes,
          bookmarks, saved flashcards (the card’s text and the page it came from), the prompts you save for Ask the book
          (each one’s name and text), shelves, the stars you gave books (nobody else ever sees them, and deleting a book
          you imported, or your account, deletes them), the books you removed from your library, reading and listening
          places, reader settings and the AI and voice models you chose. An API key you save is kept encrypted, and is
          never shown or sent back to your browser.
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
            contents or a password. The one exception is a book removed after a legal notice, described below;
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
      </Part>

      <Part id="why" title="Why Folio keeps it">
        <p>
          Folio keeps your account and what you add to it to run the service you asked for. It keeps sessions, sign-in
          attempts and the activity log to keep accounts safe and to stop abuse. It keeps records of legal notices
          because the law asks for them. Nothing is used for anything else.
        </p>
      </Part>

      <Part id="notices" title="Legal notices">
        <p>
          Folio doesn’t browse anyone’s library. To act on a copyright or other legal notice, the operator may search
          book titles and authors across accounts, and remove the book the notice names. Each search is recorded in the
          activity log with the search text and the reason, and each removal with the reason, the book’s title and its
          owner’s username. Those records are kept for a year, even if the account is deleted.
        </p>
        <p>
          The notice and the replies are kept as email for as long as they’re needed, and at most 3 years. If your book
          is removed, you’re told what was removed and why, and who sent the notice, unless the law forbids it.
        </p>
      </Part>

      <Part id="who-else" title="Who else sees it">
        <p>Resend sends Folio’s mail, so it receives your address and the message.</p>
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
        <p>
          Folio gives your data to no one else, unless the law requires it. Nothing is sold. There are no ads, analytics
          or trackers.
        </p>
        <p>Folio’s code is public, and your data isn’t part of it.</p>
      </Part>

      <Part id="rights" title="Your choices and rights">
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
        <p>You have the right to:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>get a copy of your data, which is the download on your account page;</li>
          <li>correct it, on your account page;</li>
          <li>delete it, by deleting your account;</li>
          <li>object to a use of your data, or ask Folio to restrict it, by writing to the contact below;</li>
          <li>complain to the data protection authority where you live.</li>
        </ul>
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
