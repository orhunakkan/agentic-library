import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'

const link = 'font-medium text-accent hover:text-accent-strong hover:underline'

/** The questions, in order. `sourceUrl` is null when the code isn't linked, as in `HomeFooter`. */
function questions(sourceUrl: string | null): { q: string; a: ReactNode }[] {
  return [
    {
      q: 'Do I need an account to read?',
      a: 'No. The whole library and read aloud are open to everyone, and so is installing Folio as an app. An account adds Ask the AI, your own books, audiobooks and articles, highlights, notes and flashcards, word lookup, running code, GitHub repositories, reading goals, shelves, offline reading, sync across devices and passkeys; the Sign in page says how to get one.',
    },
    {
      q: 'What do the AI features cost?',
      a: 'Folio doesn’t charge for them. You add your own Anthropic or OpenAI API key, and they bill you for what you use: a question to Ask costs from about a cent to a few dollars, depending on the model and how much of the book it reads.',
    },
    {
      q: 'Are my own books private?',
      a: 'Yes. Only you can open them. They never appear in the library, in search or in share links, and deleting one removes it at once.',
    },
    {
      q: 'Which voices does Read aloud use?',
      a: 'The ones on your device, so it’s free and works in any language your device speaks. Online voices are labelled, because they send the text to their maker to be spoken.',
    },
    {
      q: 'Does Folio work offline?',
      a: 'With an account, download a book to read it with no connection. Downloads are removed when you sign out.',
    },
    {
      q: 'Is Folio open source?',
      a: sourceUrl ? (
        <>
          Yes, under the MIT licence. Read the{' '}
          <a href={sourceUrl} rel="noopener" className={link} data-testid="faq-source-link">
            source code
          </a>{' '}
          to see how it works, or to run your own copy.
        </>
      ) : (
        'Yes, under the MIT licence, so you can read how it works or run your own copy.'
      ),
    },
  ]
}

export function Faq({ sourceUrl }: { sourceUrl: string | null }) {
  return (
    <section id="faq" aria-labelledby="faq-title" className="mt-24 scroll-mt-20 sm:mt-32">
      <h2
        id="faq-title"
        className="font-display text-[34px] leading-tight font-bold tracking-tight text-ink sm:text-[44px]"
      >
        Questions
      </h2>
      <div className="mt-8 divide-y divide-line-soft border-y border-line-soft">
        {questions(sourceUrl).map(({ q: question, a: answer }) => (
          <details key={question} className="group">
            <summary
              data-testid="faq-question"
              data-key={question}
              className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[18px] font-semibold text-ink [&::-webkit-details-marker]:hidden"
            >
              {question}
              <Plus
                aria-hidden="true"
                className="size-5 shrink-0 text-muted group-open:rotate-45 motion-safe:transition-transform"
              />
            </summary>
            <p className="max-w-[720px] pb-6 text-[16px] leading-relaxed text-body">{answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
