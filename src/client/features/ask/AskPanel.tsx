import { Switch } from '@base-ui/react/switch'
import { Link } from '@tanstack/react-router'
import { ArrowUp, Copy, Layers, ListChecks, Square, Trash2, Volume2, X } from 'lucide-react'
import { type ReactNode, type RefObject, useCallback, useEffect, useId, useRef, useState } from 'react'
import { useToast } from '~/client/components/Toast'
import { cn } from '~/client/lib/cn'
import { getAskSetup } from '~/server/account-functions'
import type { AskPromptChoice } from '~/shared/ask-prompts/prompts'
import { pageOf } from '~/shared/content/position'
import { labelOf, positionOf, type ReaderView } from '~/shared/content/reader-view'
import { type AiProvider, aiModelName, canStudyWith, providerName } from '~/shared/lib/ai-models'
import { MicButton } from '../ask-voice/MicButton'
import type { AskVoice } from '../ask-voice/use-ask-voice'
import { VoiceNotices } from '../ask-voice/VoiceNotices'
import { AnswerText } from './AnswerText'
import { AskFailureNotice } from './AskFailureNotice'
import { plainAnswer } from './answer-format'
import { type AskAction, QUESTION_MAX } from './ask-client'
import { failureText, NEEDS_CLAUDE_TEXT, problemText } from './ask-problems'
import { CardsTurn } from './CardsTurn'
import { PromptsMenu } from './PromptsMenu'
import { PROMPTS_HINT, promptsFor } from './prompts'
import { QuizTurn } from './QuizTurn'
import { QUIZ_QUESTION, quickQuestions, type Suggestion, suggestions } from './suggestions'
import type { ThreadTurn } from './thread-store'
import type { AskFailure, useAsk } from './use-ask'

export type AskState = ReturnType<typeof useAsk>

type Setup = Awaited<ReturnType<typeof getAskSetup>>

const COUNT_FROM = 1_800

function useSetup(active: boolean, signedIn: boolean) {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [version, setVersion] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is how refresh() asks again
  useEffect(() => {
    if (!active || !signedIn) return
    let live = true
    getAskSetup()
      .then((s) => live && setSetup(s))
      .catch(() => live && setSetup({ signedIn: false }))
    return () => {
      live = false
    }
  }, [active, signedIn, version])
  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  return [signedIn ? setup : ({ signedIn: false } as const), refresh] as const
}

type Blocker = 'signed_out' | 'no_key'

function blockedBy(setup: Setup | null): Blocker | null {
  if (!setup) return null
  if (!setup.signedIn) return 'signed_out'
  return setup.hasKey ? null : 'no_key'
}

function waitingText(action: AskAction | null): string {
  if (action === 'quiz') return 'Writing your quiz…'
  if (action === 'flashcards') return 'Writing your flashcards…'
  return 'Reading the book…'
}

function statusText(pending: AskState['pending'], failure: AskFailure | null, provider: AiProvider): string {
  if (pending) return pending.text ? '' : waitingText(pending.action)
  return failure ? failureText(failure.problem, undefined, failure.action, provider) : ''
}

/** Who gets the question: the chosen model's provider, or Anthropic until the setup says. */
const providerFor = (setup: Setup | null): AiProvider => (setup?.signedIn ? setup.provider : 'anthropic')

/** Why quizzes and flashcards are off for this setup, or null when they can be made. */
const studyOffFor = (setup: Setup | null): string | null =>
  setup?.signedIn && !canStudyWith(setup.model) ? NEEDS_CLAUDE_TEXT : null

const isStudy = (id: string) => id === 'quiz' || id === 'flashcards'

export interface AskPanelProps {
  view: ReaderView
  signedIn: boolean
  ask: AskState
  voice?: AskVoice
  active: boolean
  heading: ReactNode
  onClose: () => void
  onNavigate?: () => void
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  currentHref: string
  quote?: string | null
  onClearQuote?: () => void
  highlightPages?: readonly number[]
}

export function AskPanel({
  view,
  signedIn,
  ask,
  voice,
  active,
  heading,
  onClose,
  onNavigate,
  textareaRef,
  currentHref,
  quote = null,
  onClearQuote,
  highlightPages = [],
}: AskPanelProps) {
  const [setup, refreshSetup] = useSetup(active, signedIn)
  const problem = ask.failure?.problem
  useEffect(() => {
    if (problem === 'signed_out' || problem === 'no_key' || problem === 'no_prompt') refreshSetup()
  }, [problem, refreshSetup])

  const blocked = blockedBy(setup)
  const provider = providerFor(setup)
  const studyOff = studyOffFor(setup)
  const ready = setup?.signedIn === true && setup.hasKey
  const prompts: readonly AskPromptChoice[] | null = setup?.signedIn ? setup.prompts : null
  const [question, setQuestion] = useState('')
  const ownBox = useRef<HTMLTextAreaElement>(null)
  const box = textareaRef ?? ownBox
  const startQuestion = (text: string) => {
    setQuestion(text)
    requestAnimationFrame(() => {
      box.current?.focus()
      box.current?.setSelectionRange(text.length, text.length)
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col font-sans text-r-ink">
      <div className="flex items-center gap-1 border-b border-r-line py-2 pr-2 pl-5">
        <div className="min-w-0 flex-1">
          {heading}
          {ready && (
            <Link
              to="/account/api-keys"
              hash="model"
              data-testid="ask-model"
              className="block truncate text-[12px] text-r-muted underline-offset-2 hover:text-r-ink hover:underline"
            >
              {aiModelName(setup.model)}
            </Link>
          )}
        </div>
        {!blocked && ask.thread.turns.length > 0 && (
          <button
            type="button"
            onClick={() => {
              voice?.reset()
              ask.clear()
            }}
            data-testid="ask-clear"
            className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[13px] text-r-muted transition hover:bg-r-line/60 hover:text-r-ink"
          >
            <Trash2 className="size-4" aria-hidden />
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Ask this book"
          data-testid="ask-close"
          className="grid size-11 shrink-0 place-items-center rounded-full transition hover:bg-r-line/60"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      {blocked ? (
        <Blocked kind={blocked} currentHref={currentHref} provider={provider} />
      ) : (
        <>
          <ScopeLine view={view} ask={ask} />
          <Thread
            view={view}
            ask={ask}
            voice={voice}
            onNavigate={onNavigate}
            onStart={startQuestion}
            highlightPages={highlightPages}
            noPrompts={prompts?.length === 0}
            provider={provider}
            studyOff={studyOff}
          />
          <QuestionBox
            view={view}
            ask={ask}
            voice={voice}
            question={question}
            setQuestion={setQuestion}
            box={box}
            quote={quote}
            onClearQuote={onClearQuote}
            prompts={prompts ?? []}
            provider={provider}
            studyOff={studyOff}
          />
        </>
      )}
    </div>
  )
}

const blockedLink =
  'inline-flex h-11 items-center rounded-xl bg-r-accent px-5 text-[14.5px] font-semibold text-r-paper transition hover:brightness-105'

function Blocked({ kind, currentHref, provider }: { kind: Blocker; currentHref: string; provider: AiProvider }) {
  return (
    <div className="space-y-4 px-5 py-6 text-[14.5px] leading-relaxed">
      <p data-testid="ask-blocked">{problemText(kind, provider)}</p>
      {kind === 'signed_out' ? (
        <Link to="/login" search={{ next: currentHref }} className={blockedLink} data-testid="ask-sign-in">
          Sign in
        </Link>
      ) : (
        <Link to="/account/api-keys" className={blockedLink} data-testid="ask-add-key">
          Add an API key
        </Link>
      )}
    </div>
  )
}

function ScopeLine({ view, ask }: { view: ReaderView; ask: AskState }) {
  const whole = ask.thread.wholeBook
  return (
    <div className="flex items-center justify-between gap-3 border-b border-r-line px-5 py-2.5 text-[13px]">
      <p className="min-w-0 text-r-muted" aria-live="polite" data-testid="ask-scope">
        {whole ? 'Using the whole book (may include spoilers)' : `Using pages up to ${labelOf(view)}`}
      </p>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: Switch.Root renders the switch button this label wraps */}
      <label className="flex shrink-0 cursor-pointer items-center gap-2 text-r-ink">
        <span className="max-[380px]:sr-only">Use the whole book</span>
        <Switch.Root
          checked={whole}
          onCheckedChange={(checked) => ask.setWholeBook(checked)}
          aria-label="Use the whole book"
          data-testid="ask-whole-book"
          className="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-r-line bg-r-line/70 p-0.5 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-r-accent data-[checked]:border-r-accent data-[checked]:bg-r-accent"
        >
          <Switch.Thumb className="size-4.5 rounded-full bg-r-paper shadow transition-transform data-[checked]:translate-x-4" />
        </Switch.Root>
      </label>
    </div>
  )
}

function Thread({
  view,
  ask,
  voice,
  onNavigate,
  onStart,
  highlightPages,
  noPrompts,
  provider,
  studyOff,
}: {
  view: ReaderView
  ask: AskState
  voice?: AskVoice
  onNavigate?: () => void
  onStart: (text: string) => void
  highlightPages: readonly number[]
  noPrompts: boolean
  provider: AiProvider
  studyOff: string | null
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const { thread, pending, failure } = ask
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls on each change of the thread or answer
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread.turns.length, pending?.text, failure])

  const empty = thread.turns.length === 0 && !pending && !failure
  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
      {empty ? (
        <Suggestions
          view={view}
          ask={ask}
          onStart={onStart}
          highlightPages={highlightPages}
          noPrompts={noPrompts}
          studyOff={studyOff}
        />
      ) : (
        <ol className="space-y-4" aria-label="Questions and answers">
          {thread.turns.map((turn, i) => (
            <Turn
              key={`${turn.role}-${turn.at}`}
              turn={turn}
              index={i}
              ask={ask}
              voice={voice}
              bookSlug={view.book.slug}
              onNavigate={onNavigate}
              studyOff={studyOff}
            />
          ))}
          {pending && (
            <>
              <Question text={pending.quote ? `“${pending.quote}”\n\n${pending.question}` : pending.question} />
              <li className="text-r-ink" data-testid="ask-pending">
                {pending.text ? (
                  <AnswerText text={pending.text} citations={pending.citations} onNavigate={onNavigate} />
                ) : (
                  <p className="animate-pulse text-[14px] text-r-muted">{waitingText(pending.action)}</p>
                )}
              </li>
            </>
          )}
          {failure && <AskFailureNotice failure={failure} onRetry={ask.retry} provider={provider} />}
        </ol>
      )}
      <p className="sr-only" role="status" data-testid="ask-status">
        {statusText(pending, failure, provider)}
      </p>
    </div>
  )
}

function Question({ text }: { text: string }) {
  return (
    <li className="ml-8 flex justify-end" data-testid="ask-question">
      <p className="rounded-2xl rounded-br-md bg-r-accent/12 px-3.5 py-2 text-[14.5px] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">
        <span className="sr-only">You asked: </span>
        {text}
      </p>
    </li>
  )
}

function Turn({
  turn,
  index,
  ask,
  voice,
  bookSlug,
  onNavigate,
  studyOff,
}: {
  turn: ThreadTurn
  index: number
  ask: AskState
  voice?: AskVoice
  bookSlug: string
  onNavigate?: () => void
  studyOff: string | null
}) {
  const toast = useToast()
  if (turn.role === 'user') return <Question text={turn.text} />
  if (turn.study?.kind === 'quiz') {
    return (
      <QuizTurn
        study={turn.study}
        bookSlug={bookSlug}
        busy={ask.busy}
        newQuizOff={studyOff}
        onPick={(question, choice) => ask.pick(index, question, choice)}
        onNewQuiz={() => void ask.ask(QUIZ_QUESTION, null, { action: 'quiz' })}
        onNavigate={onNavigate}
      />
    )
  }
  if (turn.study?.kind === 'cards') return <CardsTurn study={turn.study} bookSlug={bookSlug} onNavigate={onNavigate} />
  if (turn.stopped && !turn.text.trim()) {
    return (
      <li className="text-[12.5px] text-r-muted" data-testid="ask-answer" data-key={turn.at}>
        <span className="rounded-full bg-r-line/60 px-2 py-0.5" data-testid="ask-stopped">
          Stopped
        </span>
      </li>
    )
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plainAnswer(turn.text))
      toast('Answer copied')
    } catch {
      toast('Couldn’t copy the answer')
    }
  }
  return (
    <li data-testid="ask-answer" data-key={turn.at}>
      <AnswerText text={turn.text} citations={turn.citations} onNavigate={onNavigate} />
      <div className="mt-1.5 flex items-center gap-2 text-[12.5px] text-r-muted">
        {turn.stopped && (
          <span className="rounded-full bg-r-line/60 px-2 py-0.5" data-testid="ask-stopped">
            Stopped
          </span>
        )}
        <button
          type="button"
          onClick={copy}
          data-testid="ask-copy"
          data-key={turn.at}
          className="-ml-2 inline-flex min-h-9 items-center gap-1 rounded-full px-2 transition hover:bg-r-line/60 hover:text-r-ink"
        >
          <Copy className="size-3.5" aria-hidden />
          Copy
        </button>
        {voice?.canListen && <ListenButton voice={voice} index={index} text={turn.text} />}
      </div>
    </li>
  )
}

function ListenButton({ voice, index, text }: { voice: AskVoice; index: number; text: string }) {
  const playing = voice.turn.phase === 'speaking' && voice.turn.listen === index
  return (
    <button
      type="button"
      onClick={() => voice.listen(index, text)}
      aria-pressed={playing}
      data-testid="ask-answer-listen"
      data-key={index}
      className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 transition hover:bg-r-line/60 hover:text-r-ink"
    >
      {playing ? <Square className="size-3 fill-current" aria-hidden /> : <Volume2 className="size-3.5" aria-hidden />}
      {playing ? 'Stop' : 'Listen'}
    </button>
  )
}

function choose(suggestion: Suggestion, ask: AskState, onStart: (text: string) => void) {
  if (suggestion.kind === 'start') return onStart(suggestion.text)
  void ask.ask(suggestion.question, null, { highlights: suggestion.highlights, action: suggestion.action })
}

function Suggestions({
  view,
  ask,
  onStart,
  highlightPages,
  noPrompts,
  studyOff,
}: {
  view: ReaderView
  ask: AskState
  onStart: (text: string) => void
  highlightPages: readonly number[]
  noPrompts: boolean
  studyOff: string | null
}) {
  const hasCode = view.page.kind === 'chapter' && view.page.html.includes('<pre>')
  const page = pageOf(positionOf(view))
  const highlights = ask.thread.wholeBook ? highlightPages.length : highlightPages.filter((p) => p <= page).length
  const chip =
    'block w-full rounded-xl border border-r-line px-3.5 py-2.5 text-left text-[14px] transition hover:border-r-accent/60 disabled:opacity-50'
  const list = suggestions({ chapterIndex: view.chapterIndex, hasCode, highlights, wholeBook: ask.thread.wholeBook })
  return (
    <div className="space-y-2">
      <p className="mb-3 text-[13.5px] text-r-muted" data-testid="ask-intro">
        {studyOff ? 'Ask about what you’ve read.' : 'Ask about what you’ve read. Answers link to the pages they use.'}
      </p>
      {list.map((suggestion) => {
        const off = studyOff !== null && isStudy(suggestion.id)
        return (
          <button
            key={suggestion.id}
            type="button"
            className={cn(chip, off && 'cursor-not-allowed')}
            onClick={() => choose(suggestion, ask, onStart)}
            disabled={off}
            data-testid="ask-suggestion"
            data-key={suggestion.id}
          >
            {suggestion.id === 'quiz' && <ListChecks className="mr-2 -mt-0.5 inline size-4 text-r-muted" aria-hidden />}
            {suggestion.id === 'flashcards' && (
              <Layers className="mr-2 -mt-0.5 inline size-4 text-r-muted" aria-hidden />
            )}
            {suggestion.label}
            {off ? (
              <span className="mt-0.5 block text-[12.5px] text-r-muted" data-testid="ask-study-off">
                {studyOff}
              </span>
            ) : (
              suggestion.kind === 'ask' &&
              suggestion.hint && <span className="mt-0.5 block text-[12.5px] text-r-muted">{suggestion.hint}</span>
            )}
          </button>
        )
      })}
      {noPrompts && (
        <p className="pt-2 text-[13px] text-r-muted" data-testid="ask-prompts-hint">
          {PROMPTS_HINT}{' '}
          <Link
            to="/account/prompts"
            className="font-medium text-r-accent underline-offset-2 hover:underline"
            data-testid="ask-prompts-add"
          >
            Your prompts
          </Link>
        </p>
      )}
    </div>
  )
}

function QuickQuestions({ view, ask, studyOff }: { view: ReaderView; ask: AskState; studyOff: string | null }) {
  const id = useId()
  const list = quickQuestions({ chapterIndex: view.chapterIndex, wholeBook: ask.thread.wholeBook })
  return (
    <fieldset aria-label="Quick questions" className="flex min-w-0 flex-wrap gap-2">
      {list.map((quickQuestion) => {
        const off = studyOff !== null && isStudy(quickQuestion.id)
        return (
          <button
            key={quickQuestion.id}
            type="button"
            onClick={() => choose(quickQuestion, ask, () => {})}
            disabled={off}
            aria-describedby={off ? id : undefined}
            data-testid="ask-quick-question"
            data-key={quickQuestion.id}
            className="inline-flex min-h-9 items-center rounded-full border border-r-line px-3.5 text-[13px] transition hover:border-r-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {quickQuestion.label}
          </button>
        )
      })}
      {studyOff && (
        <p id={id} className="basis-full text-[12px] text-r-muted" data-testid="ask-study-off">
          {studyOff}
        </p>
      )}
    </fieldset>
  )
}

function QuestionBox({
  view,
  ask,
  voice,
  question,
  setQuestion,
  box: ref,
  quote,
  onClearQuote,
  prompts,
  provider,
  studyOff,
}: {
  view: ReaderView
  ask: AskState
  voice?: AskVoice
  question: string
  setQuestion: (text: string) => void
  box: RefObject<HTMLTextAreaElement | null>
  quote: string | null
  onClearQuote?: () => void
  prompts: readonly AskPromptChoice[]
  provider: AiProvider
  studyOff: string | null
}) {
  const id = useId()
  const fitting = promptsFor(prompts, quote !== null)
  const quick = ask.thread.turns.length > 0
  const count = [...question].length

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
  useEffect(() => {
    const box = ref.current
    if (!box) return
    box.style.height = 'auto'
    const line = Number.parseFloat(getComputedStyle(box).lineHeight) || 22
    box.style.height = `${Math.min(box.scrollHeight, line * 6 + 20)}px`
  }, [question])

  const listening = voice?.turn.phase === 'listening'
  const send = () => {
    if (ask.busy || !question.trim() || count > QUESTION_MAX) return
    voice?.typedSend()
    void ask.ask(question, quote)
    setQuestion('')
    onClearQuote?.()
  }

  const run = (prompt: AskPromptChoice) => {
    if (ask.busy) return
    void ask.ask(prompt.name, quote, { prompt: prompt.id })
    onClearQuote?.()
  }

  return (
    <div className="border-t border-r-line px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
      {!ask.busy && (quick || fitting.length > 0) && (
        <div className="mb-2 flex min-w-0 flex-wrap gap-2">
          {fitting.length > 0 && <PromptsMenu prompts={fitting} hasQuote={quote !== null} onRun={run} />}
          {quick && <QuickQuestions view={view} ask={ask} studyOff={studyOff} />}
        </div>
      )}
      {quote && (
        <figure className="mb-2 flex items-start gap-2 rounded-xl border border-r-line bg-r-paper py-2 pr-1 pl-3">
          <div className="min-w-0 flex-1">
            <figcaption className="text-[11.5px] font-medium tracking-wide text-r-muted uppercase">
              Asking about
            </figcaption>
            <blockquote
              data-testid="ask-quote"
              className="mt-0.5 line-clamp-3 font-serif text-[13.5px] leading-snug text-r-ink"
            >
              {quote}
            </blockquote>
          </div>
          <button
            type="button"
            onClick={onClearQuote}
            aria-label="Remove the quoted passage"
            data-testid="ask-quote-remove"
            className="grid size-9 shrink-0 place-items-center rounded-full text-r-muted transition hover:bg-r-line/60 hover:text-r-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        </figure>
      )}
      {voice?.supported && <VoiceNotices voice={voice} />}
      <label htmlFor={id} className="sr-only">
        Your question about this book
      </label>
      <div className="flex items-end gap-2 rounded-2xl border border-r-line bg-r-paper px-3 py-2 focus-within:border-r-accent">
        <textarea
          id={id}
          ref={ref}
          rows={1}
          value={listening ? voice.turn.heard : question}
          readOnly={listening}
          maxLength={QUESTION_MAX}
          placeholder="Ask a question about the book"
          aria-describedby={`${id}-note`}
          data-testid="ask-question-input"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          className="max-h-[calc(6lh+20px)] min-h-6 flex-1 resize-none bg-transparent py-1 text-[16px] leading-[1.45] text-r-ink outline-none placeholder:text-r-muted md:text-[15px]"
        />
        {voice?.supported && <MicButton voice={voice} />}
        {ask.busy ? (
          <button
            type="button"
            onClick={ask.stop}
            aria-label="Stop the answer"
            data-testid="ask-stop"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-r-line text-r-ink transition hover:border-r-accent/60"
          >
            <Square className="size-3.5 fill-current" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!question.trim()}
            aria-label="Send question"
            data-testid="ask-send"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-r-accent text-r-paper transition hover:brightness-105 disabled:opacity-40"
          >
            <ArrowUp className="size-4.5" aria-hidden />
          </button>
        )}
      </div>
      <div className="mt-1.5 flex items-start justify-between gap-3 text-[12px] text-r-muted">
        <p id={`${id}-note`} data-testid="ask-privacy">
          Your question and the book’s text are sent to {providerName(provider)} with your API key.
        </p>
        {count >= COUNT_FROM && (
          <p
            aria-live="polite"
            data-testid="ask-count"
            className={cn('shrink-0 tabular', count >= QUESTION_MAX && 'text-r-ink')}
          >
            {count.toLocaleString('en-GB')} / {QUESTION_MAX.toLocaleString('en-GB')}
          </p>
        )}
      </div>
    </div>
  )
}
