import { useState } from 'react'
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { ToastProvider } from '~/client/components/Toast'
import { mountAt } from '~/client/testing/router'
import type { AskSetup } from '~/server/ask/setup'
import type { AskEvent, QuizQuestion } from '~/shared/ask/events'
import { buildReaderView, positionOf } from '~/shared/content/reader-view'
import { aiModelName } from '~/shared/lib/ai-models'
import { chapterFixture, metaFor } from '../../../../tests/fixtures/books'
import { fixtureCatalog } from '../../../../tests/fixtures/catalog'
import { AskPanel } from './AskPanel'
import { failureText, NEEDS_CLAUDE_TEXT, PROBLEM_TEXT } from './ask-problems'
import { PROMPTS_HINT } from './prompts'
import { REMIND } from './suggestions'
import { threadKey } from './thread-store'
import { useAsk } from './use-ask'

/** Which model and key the reader has, as the server function reports it. The panel asks for it when it opens. */
const setupMock = vi.hoisted(() => ({ getAskSetup: vi.fn<() => Promise<AskSetup>>() }))

vi.mock('~/server/account-functions', () => ({ getAskSetup: setupMock.getAskSetup, getSpeechVoices: vi.fn() }))
/** The prompts menu reaches the player through its menu styles, and the player loads read-aloud's server functions. */
vi.mock('~/server/functions', () => ({ getSpeechChapter: vi.fn() }))

const builtView = buildReaderView({ meta: metaFor('essays'), catalog: fixtureCatalog }, chapterFixture, 'history', '2')
if (!builtView) throw new Error('The essays fixture has no page 2 of History')
const VIEW = builtView
const ASK_URL = `/read/${VIEW.book.slug}/ask`

const CLAUDE: AskSetup = {
  signedIn: true,
  hasKey: true,
  keys: { anthropic: true, openai: false },
  model: 'claude-opus-5-5',
  provider: 'anthropic',
  prompts: [],
}
const GPT: AskSetup = {
  ...CLAUDE,
  keys: { anthropic: false, openai: true },
  model: 'gpt-6.2-astra',
  provider: 'openai',
}

const CITATION = { pageHref: '/read/essays/history/1', label: 'Ch. 1 · p. 1', citedText: 'h1' }

function Harness({
  signedIn,
  initialQuote,
  onClose,
}: {
  signedIn: boolean
  initialQuote: string | null
  onClose: () => void
}) {
  const ask = useAsk(VIEW.book.slug, positionOf(VIEW))
  const [quote, setQuote] = useState(initialQuote)
  return (
    <ToastProvider>
      <aside aria-label="Ask this book">
        <AskPanel
          view={VIEW}
          signedIn={signedIn}
          ask={ask}
          active
          heading={<h2>Ask this book</h2>}
          onClose={onClose}
          currentHref={VIEW.canonicalPath}
          quote={quote}
          onClearQuote={() => setQuote(null)}
        />
      </aside>
    </ToastProvider>
  )
}

const panel = page.getByRole('complementary', { name: 'Ask this book' })
const questionBox = panel.getByRole('textbox', { name: 'Your question about this book' })
const sendButton = panel.getByRole('button', { name: 'Send question' })
const stopButton = panel.getByRole('button', { name: 'Stop the answer' })
const thread = panel.getByRole('list', { name: 'Questions and answers' })
/** A failed answer's turn. Its message is plain text inside, found with `alert.getByText`. */
const alert = panel.getByRole('alert')
/** The panel's own live region; the toast's sits outside the panel. */
const status = panel.getByRole('status')

let fetchSpy: MockInstance<typeof fetch>

beforeEach(() => {
  const forget = () => localStorage.removeItem(threadKey(VIEW.book.slug))
  forget()
  setupMock.getAskSetup.mockResolvedValue(CLAUDE)
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No answer was set up for this request'))
  return forget
})

async function openPanel({
  signedIn = true,
  quote = null,
  setup,
}: {
  signedIn?: boolean
  quote?: string | null
  setup?: AskSetup
} = {}) {
  if (setup) setupMock.getAskSetup.mockResolvedValue(setup)
  const onClose = vi.fn()
  await mountAt(VIEW.canonicalPath, <Harness signedIn={signedIn} initialQuote={quote} onClose={onClose} />, {
    viewer: signedIn ? { username: 'reader' } : null,
  })
  await expect.element(panel).toBeVisible()
  return onClose
}

/** Waits for the setup to arrive, which the model's name under the heading shows. */
async function openReadyPanel(options: { quote?: string | null; setup?: AskSetup } = {}) {
  const ready = options.setup ?? CLAUDE
  if (!ready.signedIn) throw new Error('A ready panel needs a signed-in setup')
  const onClose = await openPanel(options)
  await expect.element(panel.getByRole('link', { name: aiModelName(ready.model) })).toBeVisible()
  return onClose
}

const encoder = new TextEncoder()

/**
 * Answers the next question with a stream the test writes to, one JSON event per line as /read/:slug/ask sends them.
 * Hanging up (Stop) errors the stream, as the browser does when a fetch is aborted.
 */
function streamNextAnswer() {
  const writer: { controller: ReadableStreamDefaultController<Uint8Array> | null } = { controller: null }
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      writer.controller = controller
    },
  })
  fetchSpy.mockImplementationOnce(async (_input, init) => {
    init?.signal?.addEventListener('abort', () => writer.controller?.error(new DOMException('Aborted', 'AbortError')))
    return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } })
  })
  return {
    send: (...events: AskEvent[]) => {
      for (const event of events) writer.controller?.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
    },
    end: () => writer.controller?.close(),
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The body of the nth question sent to the ask route, parsed. */
function sentQuestion(n = 0): unknown {
  const asks = fetchSpy.mock.calls.filter(([input]) => input === ASK_URL)
  const body = asks[n]?.[1]?.body
  return typeof body === 'string' ? JSON.parse(body) : null
}

async function askByTyping(question: string) {
  await questionBox.fill(question)
  await userEvent.keyboard('{Enter}')
}

describe('AskPanel', () => {
  it('streams the answer in as it comes, with its source, and keeps it in the thread', async () => {
    await openReadyPanel()
    const stream = streamNextAnswer()
    await expect.element(questionBox).toHaveAccessibleDescription(/sent to Anthropic with your API key/)
    await askByTyping('Why does history matter?')

    await expect.element(thread.getByText('You asked: Why does history matter?')).toBeVisible()
    /** The waiting line is plain text in the thread; the live region says the same to a screen reader. */
    await expect.element(thread.getByText('Reading the book…')).toBeVisible()
    await expect.element(status).toHaveTextContent('Reading the book…')
    await expect.element(stopButton).toBeVisible()
    await expect.element(sendButton).not.toBeInTheDocument()
    await expect.element(questionBox).toHaveValue('')
    expect(sentQuestion()).toMatchObject({
      question: 'Why does history matter?',
      quote: null,
      wholeBook: false,
      history: [],
      position: positionOf(VIEW),
    })
    expect(fetchSpy).toHaveBeenCalledWith(ASK_URL, expect.objectContaining({ method: 'POST' }))

    stream.send({ type: 'text', text: 'Every mind is one ' })
    /** The answer so far is plain text in the thread. */
    await expect.element(thread.getByText('Every mind is one')).toBeVisible()
    await expect.element(status).toHaveTextContent('')
    stream.send({ type: 'text', text: 'mind, the essay says.' }, { type: 'citation', ...CITATION })
    /** The source chip follows the words in the same paragraph. */
    await expect.element(thread.getByText('Every mind is one mind, the essay says.', { exact: false })).toBeVisible()
    const source = thread.getByRole('link', { name: 'Source: Ch. 1 · p. 1' })
    await expect.element(source).toHaveAttribute('href', CITATION.pageHref)
    await expect.element(stopButton).toBeVisible()

    stream.send({ type: 'done', stop: 'end_turn' })
    await expect.element(sendButton).toBeVisible()
    await expect.element(thread.getByRole('button', { name: 'Copy' })).toBeVisible()
    await expect.element(panel.getByRole('button', { name: 'Clear' })).toBeVisible()
    await expect.element(panel.getByRole('group', { name: 'Quick questions' })).toBeVisible()
    const saved: unknown = JSON.parse(localStorage.getItem(threadKey(VIEW.book.slug)) ?? 'null')
    expect(saved).toMatchObject({
      turns: [
        { role: 'user', text: 'Why does history matter?' },
        { role: 'assistant', text: expect.stringContaining('Every mind is one mind'), citations: [CITATION] },
      ],
    })
  })

  it('sends the earlier turns with a follow-up question', async () => {
    await openReadyPanel()
    const first = streamNextAnswer()
    await askByTyping('Who wrote this?')
    first.send({ type: 'text', text: 'Emerson.' }, { type: 'done', stop: 'end_turn' })
    await expect.element(thread.getByText('Emerson.')).toBeVisible()

    const second = streamNextAnswer()
    await askByTyping('When?')
    expect(sentQuestion(1)).toMatchObject({
      question: 'When?',
      history: [
        { role: 'user', text: 'Who wrote this?' },
        { role: 'assistant', text: 'Emerson.' },
      ],
    })
    second.send({ type: 'text', text: 'In 1841.' }, { type: 'done', stop: 'end_turn' })
    await expect.element(thread.getByText('In 1841.')).toBeVisible()
  })

  it('stops an answer part way and keeps what came, marked Stopped', async () => {
    await openReadyPanel()
    const stream = streamNextAnswer()
    await askByTyping('Tell me everything')
    stream.send({ type: 'text', text: 'It begins with' })
    await expect.element(thread.getByText('It begins with')).toBeVisible()

    await stopButton.click()
    /** The badge is plain text beside the kept answer. */
    await expect.element(thread.getByText('Stopped')).toBeVisible()
    await expect.element(thread.getByText('It begins with')).toBeVisible()
    await expect.element(sendButton).toBeVisible()
    await expect.element(alert).not.toBeInTheDocument()
  })

  it('copies an answer as plain text and says so', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await openReadyPanel()
    const stream = streamNextAnswer()
    await askByTyping('Quote it')
    stream.send(
      { type: 'text', text: 'It says **this**.' },
      { type: 'citation', ...CITATION },
      { type: 'done', stop: 'end_turn' },
    )
    await thread.getByRole('button', { name: 'Copy' }).click()
    /** The citation's marker goes; the answer's own markdown stays. */
    expect(write).toHaveBeenCalledWith('It says **this**.')
    const toast = page.getByTestId('toast')
    await expect.element(toast).toHaveRole('status')
    await expect.element(toast).toHaveTextContent('Answer copied')

    write.mockRejectedValue(new Error('denied'))
    await thread.getByRole('button', { name: 'Copy' }).click()
    await expect.element(toast).toHaveTextContent('Couldn’t copy the answer')
  })

  it('clears the thread back to the suggestions, and forgets it', async () => {
    await openReadyPanel()
    const stream = streamNextAnswer()
    await askByTyping('A question')
    stream.send({ type: 'text', text: 'An answer.' }, { type: 'done', stop: 'end_turn' })
    await expect.element(thread.getByText('An answer.')).toBeVisible()

    await panel.getByRole('button', { name: 'Clear' }).click()
    await expect.element(thread).not.toBeInTheDocument()
    await expect.element(panel.getByRole('button', { name: 'Summarise this chapter so far' })).toBeVisible()
    await expect.element(panel.getByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
    expect(localStorage.getItem(threadKey(VIEW.book.slug))).toBeNull()
  })

  it('shows the thread saved on this device when it opens', async () => {
    localStorage.setItem(
      threadKey(VIEW.book.slug),
      JSON.stringify({
        v: 1,
        wholeBook: true,
        turns: [
          { role: 'user', text: 'What came before?', citations: [], at: 1 },
          { role: 'assistant', text: '', citations: [], at: 2, stopped: true },
        ],
      }),
    )
    await openReadyPanel()
    await expect.element(thread.getByText('You asked: What came before?')).toBeVisible()
    /** A stopped answer with no words is only its badge, in plain text. */
    await expect.element(thread.getByText('Stopped')).toBeVisible()
    await expect.element(thread.getByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
    await expect.element(panel.getByRole('switch', { name: 'Use the whole book' })).toBeChecked()
  })

  describe('empty thread', () => {
    it('offers suggestions, a link to make prompts, and the model in use', async () => {
      await openReadyPanel()
      const model = panel.getByRole('link', { name: 'Claude Opus 5.5' })
      await expect.element(model).toHaveAttribute('href', '/account/api-keys#model')
      await expect.element(thread).not.toBeInTheDocument()
      /** The intro and the scope line are plain text. */
      await expect.element(panel.getByText('Answers link to the pages they use.', { exact: false })).toBeVisible()
      await expect.element(panel.getByText('Using pages up to Ch. 1 · p. 2')).toBeVisible()
      for (const name of [
        'Summarise this chapter so far',
        'Quiz me on this chapter so far',
        'Make flashcards from this chapter so far',
        'Remind me what the book has said about …',
      ])
        await expect.element(panel.getByRole('button', { name })).toBeEnabled()
      /** The essays' first chapter has no earlier chapter to recap. */
      await expect.element(panel.getByRole('button', { name: 'Recap the book so far' })).not.toBeInTheDocument()
      /** The hint is plain text before its link. */
      await expect.element(panel.getByText(PROMPTS_HINT, { exact: false })).toBeVisible()
      await expect
        .element(panel.getByRole('link', { name: 'Your prompts' }))
        .toHaveAttribute('href', '/account/prompts')
      await expect.element(sendButton).toBeDisabled()
      await expect.element(panel.getByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
    })

    it('asks a suggestion as it is, with its action', async () => {
      await openReadyPanel()
      const stream = streamNextAnswer()
      await panel.getByRole('button', { name: 'Summarise this chapter so far' }).click()
      await expect.element(thread.getByText('You asked: Summarise this chapter so far.')).toBeVisible()
      expect(sentQuestion()).toMatchObject({ question: 'Summarise this chapter so far.', action: 'summary' })
      stream.send({ type: 'text', text: 'It is about history.' }, { type: 'done', stop: 'end_turn' })
      await expect.element(thread.getByText('It is about history.')).toBeVisible()
    })

    it('makes a quiz from the suggestion, and marks the choice picked', async () => {
      const question: QuizQuestion = {
        question: 'What is history, the essay says?',
        choices: ['A list of kings', 'One mind', 'A war', 'A map'],
        answer: 1,
        why: 'The essay says all minds are one.',
        citations: [CITATION],
        source: { position: positionOf(VIEW), label: 'Ch. 1 · p. 2' },
      }
      await openReadyPanel()
      const stream = streamNextAnswer()
      await panel.getByRole('button', { name: 'Quiz me on this chapter so far' }).click()
      await expect.element(thread.getByText('Writing your quiz…')).toBeVisible()
      await expect.element(status).toHaveTextContent('Writing your quiz…')
      expect(sentQuestion()).toMatchObject({ action: 'quiz' })

      stream.send({ type: 'quiz', span: 'chapter', questions: [question] }, { type: 'done', stop: 'end_turn' })
      const quizQuestion = thread.getByRole('group', { name: '1. What is history, the essay says?' })
      await expect.element(quizQuestion).toBeVisible()
      await quizQuestion.getByRole('button', { name: /One mind/ }).click()
      /** The verdict is plain text under the question. */
      await expect.element(quizQuestion.getByText('Right.')).toBeVisible()
      await expect.element(quizQuestion.getByRole('button', { name: /One mind/ })).toBeDisabled()
      /** The score line is plain text under the quiz. */
      await expect.element(thread.getByText('You got 1 of 1 right.')).toBeVisible()
    })

    it('says a quiz that never came failed', async () => {
      await openReadyPanel()
      const stream = streamNextAnswer()
      await panel.getByRole('button', { name: 'Make flashcards from this chapter so far' }).click()
      await expect.element(thread.getByText('Writing your flashcards…')).toBeVisible()
      stream.send({ type: 'done', stop: 'end_turn' })
      await expect.element(alert.getByText(PROBLEM_TEXT.failed)).toBeVisible()
      await expect.element(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
    })

    it('turns quizzes and flashcards off with a GPT model, and names OpenAI', async () => {
      await openReadyPanel({ setup: GPT })
      for (const name of ['Quiz me on this chapter so far', 'Make flashcards from this chapter so far']) {
        const button = panel.getByRole('button', { name: new RegExp(name) })
        await expect.element(button).toBeDisabled()
        await expect.element(button.getByText(NEEDS_CLAUDE_TEXT)).toBeVisible()
      }
      await expect.element(panel.getByRole('button', { name: 'Summarise this chapter so far' })).toBeEnabled()
      await expect
        .element(panel.getByText('Answers link to the pages they use.', { exact: false }))
        .not.toBeInTheDocument()
      await expect.element(questionBox).toHaveAccessibleDescription(/sent to OpenAI with your API key/)
    })
  })

  describe('blocked', () => {
    it('asks a signed-out reader to sign in, and returns them here after', async () => {
      await openPanel({ signedIn: false })
      /** The reason is plain text above the link. */
      await expect.element(panel.getByText(PROBLEM_TEXT.signed_out)).toBeVisible()
      const signIn = panel.getByRole('link', { name: 'Sign in' })
      await expect.element(signIn).toHaveAttribute('href', `/login?next=${encodeURIComponent(VIEW.canonicalPath)}`)
      await expect.element(questionBox).not.toBeInTheDocument()
      await expect.element(panel.getByRole('button', { name: 'Close Ask this book' })).toBeVisible()
      expect(setupMock.getAskSetup).not.toHaveBeenCalled()
    })

    it('treats a setup that failed to load as signed out', async () => {
      setupMock.getAskSetup.mockRejectedValue(new Error('offline'))
      await openPanel()
      await expect.element(panel.getByRole('link', { name: 'Sign in' })).toBeVisible()
      await expect.element(questionBox).not.toBeInTheDocument()
    })

    it('asks for an API key for the chosen model’s provider', async () => {
      await openPanel({ setup: { ...CLAUDE, hasKey: false } })
      await expect.element(panel.getByText(PROBLEM_TEXT.no_key)).toBeVisible()
      await expect
        .element(panel.getByRole('link', { name: 'Add an API key' }))
        .toHaveAttribute('href', '/account/api-keys')
      await expect.element(questionBox).not.toBeInTheDocument()
    })

    it('names OpenAI when a GPT model has no key', async () => {
      await openPanel({ setup: { ...GPT, hasKey: false } })
      await expect.element(panel.getByText('Add an OpenAI API key to ask questions with a GPT model.')).toBeVisible()
    })

    it('checks the setup again when the server says the key is gone, and asks for one', async () => {
      await openReadyPanel()
      setupMock.getAskSetup.mockResolvedValue({ ...CLAUDE, hasKey: false })
      fetchSpy.mockResolvedValueOnce(json(400, { error: 'no_key' }))
      await askByTyping('Still there?')
      await expect.element(panel.getByRole('link', { name: 'Add an API key' })).toBeVisible()
      expect(setupMock.getAskSetup).toHaveBeenCalledTimes(2)
    })
  })

  describe('errors', () => {
    it('says the hourly limit is reached and when to try again, with no Retry', async () => {
      const retryAt = '2026-11-26T15:30:00.000Z'
      await openReadyPanel()
      fetchSpy.mockResolvedValueOnce(json(429, { error: 'limit', retryAt }))
      await askByTyping('One more')
      await expect.element(alert.getByText(failureText('limit', retryAt))).toBeVisible()
      await expect.element(alert.getByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
      await expect.element(sendButton).toBeVisible()
    })

    it('says the provider is busy, and Retry asks the same question again', async () => {
      await openReadyPanel()
      const busy = streamNextAnswer()
      await askByTyping('Are you there?')
      busy.send({ type: 'error', code: 'busy' })
      await expect.element(alert.getByText(PROBLEM_TEXT.busy)).toBeVisible()

      const answer = streamNextAnswer()
      await alert.getByRole('button', { name: 'Retry' }).click()
      expect(sentQuestion(1)).toEqual(sentQuestion(0))
      answer.send({ type: 'text', text: 'Yes.' }, { type: 'done', stop: 'end_turn' })
      await expect.element(thread.getByText('Yes.')).toBeVisible()
      await expect.element(alert).not.toBeInTheDocument()
    })

    it('points to the API keys page when the key is rejected', async () => {
      await openReadyPanel()
      const stream = streamNextAnswer()
      await askByTyping('Hello?')
      stream.send({ type: 'error', code: 'key_rejected' })
      await expect.element(alert.getByText(PROBLEM_TEXT.key_rejected)).toBeVisible()
      await expect.element(alert.getByRole('link', { name: 'API keys' })).toHaveAttribute('href', '/account/api-keys')
      await expect.element(alert.getByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    })

    it('says when the model refused to answer', async () => {
      await openReadyPanel()
      const stream = streamNextAnswer()
      await askByTyping('Something it won’t answer')
      stream.send({ type: 'done', stop: 'refusal' })
      await expect.element(alert.getByText(PROBLEM_TEXT.refusal)).toBeVisible()
    })

    it('fails an answer whose stream ends early, or that never arrives', async () => {
      await openReadyPanel()
      const stream = streamNextAnswer()
      await askByTyping('Cut off')
      stream.send({ type: 'text', text: 'Half' })
      stream.end()
      await expect.element(alert.getByText(PROBLEM_TEXT.failed)).toBeVisible()

      /** The stand-in server has no second answer set up, so the retry's request fails before it arrives. */
      await alert.getByRole('button', { name: 'Retry' }).click()
      await expect.poll(() => fetchSpy.mock.calls.filter(([input]) => input === ASK_URL)).toHaveLength(2)
      await expect.element(alert.getByText(PROBLEM_TEXT.failed)).toBeVisible()
    })
  })

  describe('the question box', () => {
    it('sends nothing for an empty question, and Shift+Enter starts a new line', async () => {
      await openReadyPanel()
      await questionBox.fill('   ')
      await expect.element(sendButton).toBeDisabled()
      await userEvent.keyboard('{Enter}')
      expect(fetchSpy).not.toHaveBeenCalled()

      await questionBox.fill('First line')
      await userEvent.keyboard('{Shift>}{Enter}{/Shift}Second line')
      await expect.element(questionBox).toHaveValue('First line\nSecond line')
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('counts the characters as a long question nears the limit', async () => {
      await openReadyPanel()
      await questionBox.fill('a'.repeat(1_799))
      /** The count is plain text under the box, read out as it changes. */
      await expect.element(panel.getByText('1,799 / 2,000')).not.toBeInTheDocument()
      await questionBox.fill('a'.repeat(1_800))
      await expect.element(panel.getByText('1,800 / 2,000')).toBeVisible()
      await expect.element(questionBox).toHaveAttribute('maxlength', '2000')
    })

    it('asks about a quoted passage, which can be removed first', async () => {
      await openReadyPanel({ quote: 'To believe your own thought' })
      /** The quote is a blockquote, which has no accessible name. */
      await expect.element(panel.getByText('To believe your own thought')).toBeVisible()
      await panel.getByRole('button', { name: 'Remove the quoted passage' }).click()
      await expect.element(panel.getByText('To believe your own thought')).not.toBeInTheDocument()
    })

    it('sends the quote with the question, then lets it go', async () => {
      await openReadyPanel({ quote: 'To believe your own thought' })
      const stream = streamNextAnswer()
      await askByTyping('What does this mean?')
      expect(sentQuestion()).toMatchObject({ question: 'What does this mean?', quote: 'To believe your own thought' })
      await expect.element(panel.getByRole('button', { name: 'Remove the quoted passage' })).not.toBeInTheDocument()
      await expect
        .element(thread.getByText(/You asked: “To believe your own thought”\s+What does this mean\?/))
        .toBeVisible()
      stream.send({ type: 'text', text: 'Trust yourself.' }, { type: 'done', stop: 'end_turn' })
      await expect.element(thread.getByText('Trust yourself.')).toBeVisible()
    })
  })

  describe('keyboard', () => {
    it('sends with Enter, and Tab goes from the box to Send', async () => {
      await openReadyPanel()
      await questionBox.fill('Typed then tabbed')
      await userEvent.keyboard('{Tab}')
      await expect.element(sendButton).toHaveFocus()
      const stream = streamNextAnswer()
      await userEvent.keyboard('{Enter}')
      expect(sentQuestion()).toMatchObject({ question: 'Typed then tabbed' })
      await expect.element(stopButton).toBeVisible()
      stream.send({ type: 'text', text: 'Done.' }, { type: 'done', stop: 'end_turn' })
      await expect.element(thread.getByText('Done.')).toBeVisible()
    })

    it('reaches the box from the suggestions with Tab, and back with Shift+Tab', async () => {
      await openReadyPanel()
      panel.getByRole('link', { name: 'Your prompts' }).element().focus()
      await userEvent.keyboard('{Tab}')
      await expect.element(questionBox).toHaveFocus()
      await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
      await expect.element(panel.getByRole('link', { name: 'Your prompts' })).toHaveFocus()
    })

    it('starts a Remind me question in the box, focused with the caret at the end', async () => {
      await openReadyPanel()
      panel.getByRole('button', { name: 'Remind me what the book has said about …' }).element().focus()
      await userEvent.keyboard('{Enter}')
      await expect.element(questionBox).toHaveFocus()
      await expect.element(questionBox).toHaveValue(REMIND)
      await userEvent.keyboard('self-reliance')
      await expect.element(questionBox).toHaveValue(`${REMIND}self-reliance`)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('switches to the whole book with Space, and asks about it', async () => {
      await openReadyPanel()
      const wholeBook = panel.getByRole('switch', { name: 'Use the whole book' })
      await expect.element(wholeBook).not.toBeChecked()
      wholeBook.element().focus()
      await userEvent.keyboard(' ')
      await expect.element(wholeBook).toBeChecked()
      await expect.element(panel.getByText('Using the whole book (may include spoilers)')).toBeVisible()
      await expect.element(panel.getByRole('button', { name: 'Summarise this chapter', exact: true })).toBeVisible()

      const stream = streamNextAnswer()
      await askByTyping('How does it end?')
      expect(sentQuestion()).toMatchObject({ wholeBook: true })
      stream.send({ type: 'done', stop: 'end_turn' })
      await expect.element(sendButton).toBeVisible()
    })

    it('closes with Enter on its Close button', async () => {
      const onClose = await openReadyPanel()
      panel.getByRole('button', { name: 'Close Ask this book' }).element().focus()
      await userEvent.keyboard('{Enter}')
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('runs a saved prompt from its menu with the arrow keys, and Escape closes the menu', async () => {
      await openReadyPanel({
        setup: {
          ...CLAUDE,
          prompts: [
            { id: 'plain', name: 'Explain like I’m new', appliesTo: 'pages' },
            { id: 'argument', name: 'Find the argument', appliesTo: 'pages' },
            { id: 'passage', name: 'Reword this passage', appliesTo: 'passage' },
          ],
        },
      })
      await expect.element(panel.getByText(PROMPTS_HINT, { exact: false })).not.toBeInTheDocument()
      const trigger = panel.getByRole('button', { name: 'Your prompts' })
      const menu = page.getByRole('menu', { name: 'Your prompts' })

      trigger.element().focus()
      await userEvent.keyboard('{ArrowDown}')
      await expect.element(menu).toBeVisible()
      await expect.element(menu.getByRole('menuitem', { name: 'Reword this passage' })).not.toBeInTheDocument()
      await expect.element(menu.getByRole('menuitem', { name: 'Explain like I’m new' })).toHaveFocus()
      await userEvent.keyboard('{Escape}')
      await expect.element(menu).not.toBeInTheDocument()
      await expect.element(trigger).toHaveFocus()

      await userEvent.keyboard('{ArrowDown}')
      await expect.element(menu.getByRole('menuitem', { name: 'Explain like I’m new' })).toHaveFocus()
      await userEvent.keyboard('{ArrowDown}')
      await expect.element(menu.getByRole('menuitem', { name: 'Find the argument' })).toHaveFocus()
      const stream = streamNextAnswer()
      await userEvent.keyboard('{Enter}')
      await expect.element(menu).not.toBeInTheDocument()
      expect(sentQuestion()).toMatchObject({ question: 'Find the argument', prompt: 'argument' })
      stream.send({ type: 'text', text: 'The argument is…' }, { type: 'done', stop: 'end_turn' })
      await expect.element(thread.getByText('The argument is…')).toBeVisible()
    })
  })
})
