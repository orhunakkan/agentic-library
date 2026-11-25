import { Drawer } from '@base-ui/react/drawer'
import { Popover } from '@base-ui/react/popover'
import { Tabs } from '@base-ui/react/tabs'
import { Link } from '@tanstack/react-router'
import { Copy, Lightbulb, X } from 'lucide-react'
import { type ElementType, useRef, useState } from 'react'
import { useToast } from '~/client/components/Toast'
import { BottomSheet } from '~/client/features/reader/Sheets'
import { cn } from '~/client/lib/cn'
import type { Tone } from '~/shared/content/schema'
import { type AiProvider, aiModelName, isAiModel } from '~/shared/lib/ai-models'
import type { DictionaryEntry, WordAnswer, WordSource } from '~/shared/lookup/contract'
import { englishName, primaryLanguage, type TranslateLanguage, translateOptions } from '~/shared/lookup/languages'
import { ProNotice } from '../plans/ProNotice'
import { translationText } from './lookup-answers'
import type { TranslateProblem, WordProblem } from './lookup-client'
import {
  ambiguousText,
  explainUsesText,
  keyRejected,
  NO_ENTRY_HINT,
  type Notice as NoticeText,
  noArticleText,
  noEntryText,
  noKeyText,
  otherLanguageText,
  SIGNED_OUT_TEXT,
  SOURCE_NAME,
  translatedByText,
  translateNotice,
  translatePrivacyText,
  wordNotice,
} from './lookup-messages'
import { writeTarget } from './lookup-prefs'
import type { Loaded, LookupState, LookupTab, Setup } from './use-lookup'

/** The provider the reader's chosen model uses, and so the one their text goes to; Anthropic until known. */
const providerFor = (setup: Setup | null): AiProvider => (setup?.signedIn ? setup.provider : 'anthropic')

const action =
  'inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-[14px] font-semibold transition focus-visible:outline-2 focus-visible:outline-r-accent'
const primary = cn(action, 'bg-r-accent text-r-paper hover:brightness-105')
const secondary = cn(action, 'border border-r-line text-r-ink hover:bg-r-line/60')
const textLink =
  'font-medium text-r-accent underline decoration-r-accent/40 underline-offset-2 hover:decoration-r-accent'
const tabClass =
  'relative -mb-px flex min-h-11 items-center justify-center border-b-2 border-transparent px-1 text-[13.5px] font-medium text-r-muted transition hover:text-r-ink data-[active]:border-r-accent data-[active]:text-r-ink'

function External({
  href,
  children,
  className,
  'data-testid': testId,
}: {
  href: string
  children: React.ReactNode
  className?: string
  'data-testid': string
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId} className={className ?? textLink}>
      {children}
    </a>
  )
}

function Notice({ children, onRetry }: { children: React.ReactNode; onRetry?: () => void }) {
  return (
    <div className="space-y-3 py-2" role="status" data-testid="lookup-notice">
      <p>{children}</p>
      {onRetry && (
        <button type="button" data-testid="lookup-retry" onClick={onRetry} className={secondary}>
          Retry
        </button>
      )}
    </div>
  )
}

function SignedOut({ currentHref }: { currentHref: string }) {
  return (
    <div className="space-y-3 py-2">
      <p>{SIGNED_OUT_TEXT}</p>
      <Link to="/login" search={{ next: currentHref }} data-testid="lookup-sign-in" className={primary}>
        Sign in
      </Link>
    </div>
  )
}

function NoKey({ provider }: { provider: AiProvider }) {
  return (
    <div className="space-y-3 py-2">
      <p>{noKeyText(provider)}</p>
      <Link to="/account/api-keys" data-testid="lookup-add-key" className={primary}>
        Add a key
      </Link>
    </div>
  )
}

function Shown({ notice, onRetry }: { notice: NoticeText; onRetry: () => void }) {
  return <Notice onRetry={notice.retry ? onRetry : undefined}>{notice.text}</Notice>
}

function WordFailure({
  source,
  problem,
  retryAt,
  onRetry,
  currentHref,
}: {
  source: WordSource
  problem: WordProblem
  retryAt?: Date
  onRetry: () => void
  currentHref: string
}) {
  if (problem === 'signed_out') return <SignedOut currentHref={currentHref} />
  return <Shown notice={wordNotice(source, problem, retryAt)} onRetry={onRetry} />
}

function Credit({ source, href, label }: { source: WordSource; href: string; label: string }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-r-line pt-3 text-[13px]">
      <span className="text-r-muted">From {SOURCE_NAME[source]} · CC BY-SA</span>
      <External href={href} data-testid={source === 'dictionary' ? 'lookup-open-wiktionary' : 'lookup-open-wikipedia'}>
        {label}
      </External>
    </div>
  )
}

function DictionaryAnswer({
  entry,
  bookLang,
  onLemma,
}: {
  entry: DictionaryEntry
  bookLang: string
  onLemma: (lemma: string) => void
}) {
  return (
    <div data-testid="lookup-answer">
      {entry.otherLanguage && (
        <p className="mb-2 text-r-muted">
          {otherLanguageText(englishName(primaryLanguage(bookLang)), entry.languageName)}
        </p>
      )}
      <div className="space-y-3" lang={entry.language}>
        {entry.senses.map((sense) => (
          <section key={sense.partOfSpeech}>
            <h3 className="font-semibold" lang="en">
              {sense.partOfSpeech}
            </h3>
            <ol className="mt-1 list-decimal space-y-1.5 pl-5">
              {sense.definitions.map((d, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: definitions are a fixed list per answer, in order
                <li key={i}>
                  {d.text}
                  {d.lemma && (
                    <>
                      {' '}
                      <button
                        type="button"
                        data-testid="lookup-lemma"
                        data-key={d.lemma}
                        onClick={() => d.lemma && onLemma(d.lemma)}
                        className={cn(textLink, 'cursor-pointer')}
                        lang="en"
                      >
                        Look up “{d.lemma}”
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      <Credit source="dictionary" href={entry.url} label="Open in Wiktionary" />
    </div>
  )
}

function WordPanel({
  source,
  loaded,
  term,
  bookLang,
  onLemma,
  onRetry,
  currentHref,
}: {
  source: WordSource
  loaded: Loaded<WordAnswer, WordProblem> | null
  term: string
  bookLang: string
  onLemma: (lemma: string) => void
  onRetry: () => void
  currentHref: string
}) {
  if (!loaded || loaded.status === 'loading')
    return (
      <p data-testid="lookup-loading" className="py-2 text-r-muted">
        Looking it up…
      </p>
    )
  if (!loaded.ok)
    return (
      <WordFailure
        source={source}
        problem={loaded.problem}
        retryAt={loaded.retryAt}
        onRetry={onRetry}
        currentHref={currentHref}
      />
    )
  const answer = loaded.value
  if (answer.state === 'not-found')
    return source === 'dictionary' ? (
      <div data-testid="lookup-not-found" className="space-y-1 py-2">
        <p>{noEntryText(term)}</p>
        <p className="text-r-muted">{NO_ENTRY_HINT}</p>
      </div>
    ) : (
      <div data-testid="lookup-not-found" className="space-y-3 py-2">
        <p>{noArticleText(term)}</p>
        {answer.searchUrl && (
          <External href={answer.searchUrl} data-testid="lookup-search-wikipedia" className={secondary}>
            Search Wikipedia
          </External>
        )}
      </div>
    )
  if (answer.state === 'ambiguous')
    return (
      <div data-testid="lookup-ambiguous" className="space-y-3 py-2">
        <p>{ambiguousText(answer.title)}</p>
        <External href={answer.url} data-testid="lookup-wikipedia-choices" className={secondary}>
          See the choices on Wikipedia
        </External>
      </div>
    )
  if (answer.source === 'dictionary') return <DictionaryAnswer entry={answer} bookLang={bookLang} onLemma={onLemma} />
  return (
    <div data-testid="lookup-answer" lang={primaryLanguage(bookLang)}>
      <h3 className="font-semibold">{answer.title}</h3>
      {answer.description && <p className="text-r-muted">{answer.description}</p>}
      <p className="mt-2">{answer.extract}</p>
      <Credit source="wikipedia" href={answer.url} label="Read on Wikipedia" />
    </div>
  )
}

function TranslateFailure({
  problem,
  retryAt,
  onRetry,
  currentHref,
  provider,
}: {
  problem: TranslateProblem
  retryAt?: Date
  onRetry: () => void
  currentHref: string
  provider: AiProvider
}) {
  const rejected = keyRejected(provider)
  if (problem === 'signed_out') return <SignedOut currentHref={currentHref} />
  if (problem === 'pro') return <TranslatePro />
  if (problem === 'no_key') return <NoKey provider={provider} />
  if (problem === 'key_rejected')
    return (
      <Notice>
        {rejected.before}
        <Link to="/account/api-keys" data-testid="lookup-api-keys" className={textLink}>
          {rejected.link}
        </Link>
        {rejected.after}
      </Notice>
    )
  return <Shown notice={translateNotice(problem, retryAt, provider)} onRetry={onRetry} />
}

function Translation({
  text,
  model,
  lang,
  provider,
}: {
  text: string
  model: string
  lang: TranslateLanguage
  provider: AiProvider
}) {
  const toast = useToast()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast('Copied')
    } catch {
      toast('Couldn’t copy the translation')
    }
  }
  return (
    <div>
      <div lang={lang} dir="auto" data-testid="lookup-translation" className="space-y-2">
        {text.split(/\n+/).map((paragraph, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the paragraphs of one fixed answer, in order
          <p key={i}>{paragraph}</p>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-r-line pt-3 text-[13px]">
        <span className="text-r-muted" data-testid="lookup-translated-by">
          {translatedByText(isAiModel(model) ? aiModelName(model) : model, provider)}
        </span>
        <button type="button" data-testid="lookup-copy" className={secondary} onClick={copy}>
          <Copy className="size-4" aria-hidden />
          Copy
        </button>
      </div>
    </div>
  )
}

function TranslatePro() {
  return <ProNotice feature="translate" compact className="py-2" linkClassName={textLink} />
}

function TranslateBody({ lookup, currentHref }: { lookup: LookupState; currentHref: string }) {
  const { setup, to } = lookup
  const provider = providerFor(setup)
  const translating = (
    <p data-testid="lookup-loading" className="py-2 text-r-muted">
      Translating…
    </p>
  )
  if (setup === null) return translating
  if (!setup.signedIn) return <SignedOut currentHref={currentHref} />
  if (!setup.pro) return <TranslatePro />
  if (!setup.hasKey) return <NoKey provider={provider} />
  if (!to)
    return (
      <p data-testid="lookup-choose-language" className="py-2">
        Choose a language to translate into.
      </p>
    )
  const translation = lookup.store.translation(to, translationText(lookup.target, lookup.term))
  if (!translation || translation.status === 'loading') return translating
  if (!translation.ok)
    return (
      <TranslateFailure
        problem={translation.problem}
        retryAt={translation.retryAt}
        onRetry={() => lookup.store.retry()}
        currentHref={currentHref}
        provider={provider}
      />
    )
  return (
    <Translation text={translation.value.translation} model={translation.value.model} lang={to} provider={provider} />
  )
}

function TranslatePanel({ lookup, currentHref }: { lookup: LookupState; currentHref: string }) {
  const { to } = lookup
  const options = translateOptions()
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-[13px] font-medium text-r-muted">Translate to</span>
        <select
          data-testid="lookup-language"
          value={to ?? ''}
          onChange={(e) => {
            const choice = e.target.value as TranslateLanguage
            if (!choice) return
            writeTarget(choice)
            lookup.dispatch({ type: 'to', to: choice })
          }}
          className="h-11 w-full rounded-xl border border-r-line bg-r-paper px-3 text-[14.5px] text-r-ink focus-visible:outline-2 focus-visible:outline-r-accent"
        >
          {!to && <option value="">Choose a language</option>}
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[13px] text-r-muted" data-testid="lookup-privacy">
        {translatePrivacyText(providerFor(lookup.setup))}
      </p>
      <TranslateBody lookup={lookup} currentHref={currentHref} />
    </div>
  )
}

function QuotedPassage({ text }: { text: string }) {
  const [more, setMore] = useState(false)
  return (
    <div className="mb-3">
      <blockquote className={cn('border-l-2 border-r-line pl-3 font-serif text-r-muted', !more && 'line-clamp-4')}>
        {text}
      </blockquote>
      <button
        type="button"
        data-testid="lookup-show-more"
        onClick={() => setMore((m) => !m)}
        className={cn(textLink, 'mt-1 text-[13px]')}
      >
        {more ? 'Show less' : 'Show more'}
      </button>
    </div>
  )
}

interface BodyProps {
  lookup: LookupState
  signedIn: boolean
  bookLang: string
  currentHref: string
  explainDisabled: boolean
  onExplain: (term: string, quote: string) => void
  Title: ElementType
  Close: ElementType
  headingRef: React.RefObject<HTMLHeadingElement | null>
}

function CardBody({
  lookup,
  signedIn,
  bookLang,
  currentHref,
  explainDisabled,
  onExplain,
  Title,
  Close,
  headingRef,
}: BodyProps) {
  const { target, term } = lookup
  if (!target) return null
  const passage = target.kind === 'passage'
  const header = (
    <div className="mb-2 flex items-start justify-between gap-2">
      <Title
        ref={headingRef}
        data-testid="lookup-title"
        tabIndex={-1}
        lang={passage ? undefined : bookLang}
        className={cn(
          'min-w-0 pt-1.5 break-words outline-none',
          passage ? 'font-sans text-[16px] font-semibold' : 'font-serif text-[22px] font-semibold',
        )}
      >
        {passage ? 'Translate passage' : term}
      </Title>
      <Close
        data-testid="lookup-close"
        aria-label="Close"
        className="grid size-11 shrink-0 place-items-center rounded-full transition hover:bg-r-line"
      >
        <X className="size-5" aria-hidden />
      </Close>
    </div>
  )
  const translatePanel = signedIn ? (
    <TranslatePanel lookup={lookup} currentHref={currentHref} />
  ) : (
    <SignedOut currentHref={currentHref} />
  )
  if (passage)
    return (
      <>
        {header}
        <QuotedPassage text={target.text} />
        {translatePanel}
      </>
    )
  const panel = (source: WordSource) =>
    signedIn ? (
      <WordPanel
        source={source}
        loaded={lookup.store.word(source, lookup.lang, term)}
        term={term ?? ''}
        bookLang={bookLang}
        onLemma={(lemma) => lookup.dispatch({ type: 'lemma', lemma })}
        onRetry={() => lookup.store.retry()}
        currentHref={currentHref}
      />
    ) : (
      <SignedOut currentHref={currentHref} />
    )
  return (
    <>
      {header}
      <Tabs.Root
        value={lookup.tab}
        onValueChange={(value) => lookup.dispatch({ type: 'tab', tab: value as LookupTab })}
      >
        <Tabs.List className="mb-3 grid grid-cols-3 border-b border-r-line">
          <Tabs.Tab value="dictionary" data-testid="lookup-tab" data-key="dictionary" className={tabClass}>
            Dictionary
          </Tabs.Tab>
          <Tabs.Tab value="wikipedia" data-testid="lookup-tab" data-key="wikipedia" className={tabClass}>
            Wikipedia
          </Tabs.Tab>
          <Tabs.Tab value="translate" data-testid="lookup-tab" data-key="translate" className={tabClass}>
            Translate
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="dictionary" className="outline-none">
          {lookup.tab === 'dictionary' && panel('dictionary')}
        </Tabs.Panel>
        <Tabs.Panel value="wikipedia" className="outline-none">
          {lookup.tab === 'wikipedia' && panel('wikipedia')}
        </Tabs.Panel>
        <Tabs.Panel value="translate" className="outline-none">
          {lookup.tab === 'translate' && translatePanel}
        </Tabs.Panel>
      </Tabs.Root>
      <div className="mt-4 border-t border-r-line pt-3">
        <button
          type="button"
          data-testid="lookup-explain"
          disabled={explainDisabled}
          title={explainDisabled ? 'Wait for the current answer to finish' : undefined}
          onClick={() => term && onExplain(term, target.context ?? term)}
          className={cn(secondary, 'disabled:cursor-not-allowed disabled:opacity-45')}
        >
          <Lightbulb className="size-4 text-r-accent" aria-hidden />
          Explain in context
        </button>
        <p className="mt-1.5 text-[13px] text-r-muted">{explainUsesText(providerFor(lookup.setup))}</p>
      </div>
    </>
  )
}

const pageFocus = () => {
  document.getElementById('reader-content')?.focus({ preventScroll: true })
  return false
}

export function LookupCard({
  lookup,
  signedIn,
  bookLang,
  tone,
  desktop,
  currentHref,
  explainDisabled,
  onExplain,
}: {
  lookup: LookupState
  signedIn: boolean
  bookLang: string
  tone: Tone
  desktop: boolean
  currentHref: string
  explainDisabled: boolean
  onExplain: (term: string, quote: string) => void
}) {
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const open = lookup.target !== null
  const rect = lookup.target?.rect ?? null
  const body = (Title: ElementType, Close: ElementType) => (
    <CardBody
      lookup={lookup}
      signedIn={signedIn}
      bookLang={bookLang}
      currentHref={currentHref}
      explainDisabled={explainDisabled}
      onExplain={onExplain}
      Title={Title}
      Close={Close}
      headingRef={headingRef}
    />
  )
  const text = 'font-sans text-[14.5px] leading-relaxed text-r-ink'

  if (!desktop)
    return (
      <BottomSheet
        open={open}
        onOpenChange={(next) => !next && lookup.dispatch({ type: 'close' })}
        tone={tone}
        initialFocus={headingRef}
        finalFocus={pageFocus}
        chrome
        data-testid="lookup-card"
        className={cn(
          'max-h-[70dvh] max-w-[640px] overflow-y-auto bg-r-paper px-5 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))]',
          text,
        )}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-r-line" aria-hidden />
        {body(Drawer.Title, Drawer.Close)}
      </BottomSheet>
    )

  const playerH =
    typeof document === 'undefined'
      ? 0
      : Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--player-h')) || 0
  return (
    <Popover.Root open={open} onOpenChange={(next) => !next && lookup.dispatch({ type: 'close' })}>
      <Popover.Portal>
        <Popover.Positioner
          anchor={rect ? { getBoundingClientRect: () => rect } : null}
          side="top"
          align="center"
          sideOffset={10}
          collisionPadding={{ top: 12, right: 12, left: 12, bottom: playerH + 12 }}
          className="z-[70]"
        >
          <Popover.Popup
            data-tone={tone}
            data-chrome
            data-testid="lookup-card"
            initialFocus={headingRef}
            finalFocus={pageFocus}
            className={cn(
              'max-h-[60vh] w-[min(360px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-r-line bg-r-paper px-4 pt-2 pb-4 shadow-[0_18px_40px_-14px_rgba(18,28,58,.35)] outline-none',
              text,
            )}
          >
            {body(Popover.Title, Popover.Close)}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
