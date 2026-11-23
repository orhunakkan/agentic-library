import { Plus } from 'lucide-react'
import { PAYING_QUESTIONS } from '~/shared/billing/copy'
import { NO_TRIAL } from '~/shared/plans/copy'

const QUESTIONS = [
  {
    q: 'Do I need an account to read?',
    a: 'No. The whole library and read aloud are open to everyone. An account adds highlights, notes, your own books and Ask the book; the Sign in page says how to get one.',
  },
  {
    q: 'Is there a free trial?',
    a: NO_TRIAL,
  },
  {
    q: 'What does Ask the book cost?',
    a: 'Folio doesn’t charge for it. You add your own Anthropic API key, and Anthropic bills you per question: from about a cent to a couple of dollars, depending on the model and how much of the book it reads.',
  },
  {
    q: 'Are my own books private?',
    a: 'Yes. Only you can open them. They never appear in the library, in search or in share links, and deleting one removes it at once.',
  },
  {
    q: 'Which voices does Read aloud use?',
    a: 'The ones on your device, so it’s free and works in any language your device speaks. Online voices are labelled, because they send the text to their maker to be spoken.',
  },
]

export function Faq({ billing }: { billing: boolean }) {
  const questions = billing ? [...QUESTIONS.slice(0, 2), ...PAYING_QUESTIONS, ...QUESTIONS.slice(2)] : QUESTIONS
  return (
    <section id="faq" aria-labelledby="faq-title" className="mt-24 scroll-mt-20 sm:mt-32">
      <h2
        id="faq-title"
        className="font-display text-[34px] leading-tight font-bold tracking-tight text-ink sm:text-[44px]"
      >
        Questions
      </h2>
      <div className="mt-8 divide-y divide-line-soft border-y border-line-soft">
        {questions.map(({ q, a }) => (
          <details key={q} className="group">
            <summary
              data-testid="faq-question"
              data-key={q}
              className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[18px] font-semibold text-ink [&::-webkit-details-marker]:hidden"
            >
              {q}
              <Plus
                aria-hidden="true"
                className="size-5 shrink-0 text-muted group-open:rotate-45 motion-safe:transition-transform"
              />
            </summary>
            <p className="max-w-[720px] pb-6 text-[16px] leading-relaxed text-body">{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
