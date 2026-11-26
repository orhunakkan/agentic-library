import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { ToastProvider } from '~/client/components/Toast'
import { mountAt } from '~/client/testing/router'
import { isObject } from '~/shared/lib/json-shape'
import type { DictionaryEntry, WikipediaSummary } from '~/shared/lookup/contract'
import { LookupCard } from './LookupCard'
import {
  NO_ENTRY_HINT,
  noEntryText,
  SIGNED_OUT_TEXT,
  translatedByText,
  translatePrivacyText,
  wordNotice,
} from './lookup-messages'
import { LOOKUP_PREFS_KEY } from './lookup-prefs'
import { type LookupTarget, type Setup, useLookup } from './use-lookup'

/** Which model and key the reader has, as the server function reports it. The card asks for it when it first opens. */
const setupMock = vi.hoisted(() => ({ getAskSetup: vi.fn<() => Promise<Setup>>() }))

vi.mock('~/server/account-functions', () => ({ getAskSetup: setupMock.getAskSetup }))

const BOOK = 'essays'
const HREF = '/read/essays/history/2'
const WORD_URL = '/account/lookup/word'
const TRANSLATE_URL = '/account/lookup/translate'

const CLAUDE: Setup = {
  signedIn: true,
  hasKey: true,
  keys: { anthropic: true, openai: false },
  model: 'claude-opus-5-5',
  provider: 'anthropic',
  prompts: [],
}

const CONTEXT = 'It was pure serendipity that we met.'
const TERM: Omit<LookupTarget, 'rect'> = { kind: 'term', text: 'serendipity', term: 'serendipity', context: CONTEXT }
const PASSAGE_TEXT =
  'There is one mind common to all individual men. Every man is an inlet to the same and to all of the same. ' +
  'He that is once admitted to the right of reason is made a freeman of the whole estate. What Plato has thought, ' +
  'he may think; what a saint has felt, he may feel; what at any time has befallen any man, he can understand.'
const PASSAGE: Omit<LookupTarget, 'rect'> = { kind: 'passage', text: PASSAGE_TEXT, term: null, context: null }

const DICTIONARY: DictionaryEntry = {
  state: 'found',
  source: 'dictionary',
  term: 'serendipity',
  language: 'en',
  languageName: 'English',
  otherLanguage: false,
  senses: [{ partOfSpeech: 'Noun', definitions: [{ text: 'A happy accident.' }, { text: 'Luck in finding things.' }] }],
  url: 'https://en.wiktionary.org/wiki/serendipity',
}
const WIKIPEDIA: WikipediaSummary = {
  state: 'found',
  source: 'wikipedia',
  title: 'Serendipity',
  description: 'Unplanned fortunate discovery',
  extract: 'Serendipity is an unplanned fortunate discovery.',
  url: 'https://en.wikipedia.org/wiki/Serendipity',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type Sent = Record<string, unknown>
type Reply = (request: Sent) => Response | Promise<Response>

const wordReply: Reply = (request) => json(200, request.source === 'wikipedia' ? WIKIPEDIA : DICTIONARY)
const translateReply: Reply = () => json(200, { translation: 'sérendipité', model: 'claude-opus-5-5' })
/** How the stand-in server answers each lookup route; a test swaps one to answer otherwise. */
const replies: { word: Reply; translate: Reply } = { word: wordReply, translate: translateReply }

function sentBody(init: RequestInit | undefined): Sent {
  const parsed: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
  return isObject(parsed) ? parsed : {}
}

let fetchSpy: MockInstance<typeof fetch>

/** The bodies sent to one lookup route, in order. */
const sentTo = (url: string) => fetchSpy.mock.calls.filter(([input]) => input === url).map(([, init]) => sentBody(init))

beforeEach(() => {
  const forget = () => localStorage.removeItem(LOOKUP_PREFS_KEY)
  forget()
  setupMock.getAskSetup.mockResolvedValue(CLAUDE)
  replies.word = wordReply
  replies.translate = translateReply
  /** A reader whose browser speaks the book's language, so Translate starts with no language chosen. */
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB'])
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (input === WORD_URL) return replies.word(sentBody(init))
    if (input === TRANSLATE_URL) return replies.translate(sentBody(init))
    throw new Error(`No answer was set up for ${String(input)}`)
  })
  return forget
})

function Harness({
  target,
  signedIn,
  desktop,
  explainDisabled,
  onExplain,
}: {
  target: Omit<LookupTarget, 'rect'>
  signedIn: boolean
  desktop: boolean
  explainDisabled: boolean
  onExplain: (term: string, quote: string) => void
}) {
  const lookup = useLookup({ book: BOOK, lang: 'en', signedIn })
  return (
    <ToastProvider>
      <main id="reader-content" tabIndex={-1}>
        <button
          type="button"
          onClick={(e) => lookup.open({ ...target, rect: e.currentTarget.getBoundingClientRect() })}
        >
          Look up
        </button>
      </main>
      <LookupCard
        lookup={lookup}
        signedIn={signedIn}
        bookLang="en"
        tone="default"
        desktop={desktop}
        currentHref={HREF}
        explainDisabled={explainDisabled}
        onExplain={onExplain}
      />
    </ToastProvider>
  )
}

const readerPage = page.getByRole('main')
const card = (name: string) => page.getByRole('dialog', { name })
const wordCard = card('serendipity')
const tab = (name: string) => wordCard.getByRole('tab', { name })
const panel = page.getByRole('tabpanel')
const notice = page.getByTestId('lookup-notice')
const retry = page.getByRole('button', { name: 'Retry' })

async function openCard({
  target = TERM,
  signedIn = true,
  desktop = true,
  explainDisabled = false,
}: {
  target?: Omit<LookupTarget, 'rect'>
  signedIn?: boolean
  desktop?: boolean
  explainDisabled?: boolean
} = {}) {
  const onExplain = vi.fn<(term: string, quote: string) => void>()
  await mountAt(
    HREF,
    <Harness
      target={target}
      signedIn={signedIn}
      desktop={desktop}
      explainDisabled={explainDisabled}
      onExplain={onExplain}
    />,
    { viewer: signedIn ? { username: 'reader' } : null },
  )
  await page.getByRole('button', { name: 'Look up' }).click()
  return onExplain
}

/** The notice is a status region with no name; its message is plain text inside it. */
async function expectNotice(text: string) {
  await expect.element(notice).toHaveRole('status')
  await expect.element(notice.getByText(text)).toBeVisible()
}

describe('LookupCard', () => {
  it('opens on the Dictionary tab, focused on the word, and shows its senses', async () => {
    const pending = Promise.withResolvers<Response>()
    replies.word = () => pending.promise
    await openCard()

    await expect.element(wordCard).toBeVisible()
    const title = wordCard.getByRole('heading', { name: 'serendipity' })
    await expect.element(title).toHaveFocus()
    await expect.element(title).toHaveAttribute('lang', 'en')
    await expect.element(wordCard.getByRole('tablist')).toBeVisible()
    await expect.element(tab('Dictionary')).toHaveAttribute('aria-selected', 'true')
    await expect.element(tab('Wikipedia')).toHaveAttribute('aria-selected', 'false')
    /** The loading line is plain text in the panel. */
    await expect.element(panel.getByText('Looking it up…')).toBeVisible()
    expect(sentTo(WORD_URL)).toEqual([{ book: BOOK, term: 'serendipity', source: 'dictionary' }])

    pending.resolve(json(200, DICTIONARY))
    await expect.element(panel.getByRole('heading', { name: 'Noun', level: 3 })).toBeVisible()
    const senses = panel.getByRole('listitem')
    await expect.element(senses.nth(0)).toHaveTextContent('A happy accident.')
    await expect.element(senses.nth(1)).toHaveTextContent('Luck in finding things.')
    const open = panel.getByRole('link', { name: 'Open in Wiktionary' })
    await expect.element(open).toHaveAttribute('href', DICTIONARY.url)
    await expect.element(open).toHaveAttribute('target', '_blank')
    /** The credit is plain text beside the link. */
    await expect.element(panel.getByText('From Wiktionary · CC BY-SA')).toBeVisible()
    await expect.element(wordCard.getByRole('button', { name: 'Explain in context' })).toBeEnabled()
    await expect.element(wordCard.getByText('Uses Ask with your Anthropic key.')).toBeVisible()
  })

  it('shows Wikipedia’s summary on its tab, loading each source once', async () => {
    await openCard()
    await expect.element(panel.getByRole('heading', { name: 'Noun' })).toBeVisible()
    await tab('Wikipedia').click()
    await expect.element(tab('Wikipedia')).toHaveAttribute('aria-selected', 'true')
    await expect.element(panel.getByRole('heading', { name: 'Serendipity', level: 3 })).toBeVisible()
    /** The description and extract are plain text under the title. */
    await expect.element(panel.getByText('Unplanned fortunate discovery')).toBeVisible()
    await expect.element(panel.getByText(WIKIPEDIA.extract)).toBeVisible()
    await expect.element(panel.getByRole('link', { name: 'Read on Wikipedia' })).toHaveAttribute('href', WIKIPEDIA.url)

    await tab('Dictionary').click()
    await expect.element(panel.getByRole('heading', { name: 'Noun' })).toBeVisible()
    expect(sentTo(WORD_URL).map((request) => request.source)).toEqual(['dictionary', 'wikipedia'])
  })

  it('translates into the language chosen, remembers it, and copies the translation', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await openCard()
    await tab('Translate').click()
    const language = panel.getByRole('combobox', { name: 'Translate to' })
    await expect.element(language).toHaveValue('')
    /** The prompt and privacy note are plain text in the panel. */
    await expect.element(panel.getByText('Choose a language to translate into.')).toBeVisible()
    await expect.element(panel.getByText(translatePrivacyText('anthropic'))).toBeVisible()
    expect(sentTo(TRANSLATE_URL)).toEqual([])

    await language.selectOptions('fr')
    await expect.element(panel.getByText('sérendipité')).toBeVisible()
    await expect.element(panel.getByText(translatedByText('Claude Opus 5.5', 'anthropic'))).toBeVisible()
    expect(sentTo(TRANSLATE_URL)).toEqual([{ book: BOOK, text: 'serendipity', context: CONTEXT, to: 'fr' }])
    expect(localStorage.getItem(LOOKUP_PREFS_KEY)).toBe(JSON.stringify({ to: 'fr' }))
    await expect.element(language.getByRole('option', { name: 'Choose a language' })).not.toBeInTheDocument()

    await panel.getByRole('button', { name: 'Copy' }).click()
    expect(write).toHaveBeenCalledWith('sérendipité')
    const toast = page.getByTestId('toast')
    await expect.element(toast).toHaveRole('status')
    await expect.element(toast).toHaveTextContent('Copied')
  })

  it('translates at once into the reader’s own language when it differs from the book’s', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'en'])
    await openCard()
    await tab('Translate').click()
    await expect.element(panel.getByRole('combobox', { name: 'Translate to' })).toHaveValue('fr')
    await expect.element(panel.getByText('sérendipité')).toBeVisible()
  })

  it('looks up the word a definition points to', async () => {
    replies.word = (request) =>
      json(
        200,
        request.term === 'run'
          ? { ...DICTIONARY, term: 'run', senses: [{ partOfSpeech: 'Verb', definitions: [{ text: 'To move fast.' }] }] }
          : {
              ...DICTIONARY,
              term: 'ran',
              senses: [{ partOfSpeech: 'Verb', definitions: [{ text: 'simple past of run', lemma: 'run' }] }],
            },
      )
    await openCard({ target: { kind: 'term', text: 'ran', term: 'ran', context: 'He ran home.' } })
    const lemma = card('ran').getByRole('button', { name: 'Look up “run”' })
    await expect.element(lemma).toBeVisible()
    await lemma.click()
    await expect.element(card('run').getByRole('heading', { name: 'run', level: 2 })).toBeVisible()
    /** The definition is plain text in its list item. */
    await expect.element(panel.getByText('To move fast.')).toBeVisible()
    expect(sentTo(WORD_URL).map((request) => request.term)).toEqual(['ran', 'run'])
  })

  it('says the dictionary has no entry, and points to the other tabs', async () => {
    replies.word = () => json(200, { state: 'not-found' })
    await openCard()
    /** The not-found lines are plain text in the panel. */
    await expect.element(panel.getByText(noEntryText('serendipity'))).toBeVisible()
    await expect.element(panel.getByText(NO_ENTRY_HINT)).toBeVisible()
  })

  it('offers a Wikipedia search when there is no article', async () => {
    const searchUrl = 'https://en.wikipedia.org/w/index.php?search=serendipity'
    replies.word = () => json(200, { state: 'not-found', searchUrl })
    await openCard()
    await tab('Wikipedia').click()
    /** The not-found line is plain text in the panel. */
    await expect.element(panel.getByText('Wikipedia has no article called “serendipity”.')).toBeVisible()
    await expect.element(panel.getByRole('link', { name: 'Search Wikipedia' })).toHaveAttribute('href', searchUrl)
  })

  it('links to Wikipedia’s choices when the title is ambiguous', async () => {
    replies.word = () => json(200, { state: 'ambiguous', title: 'Run', url: 'https://en.wikipedia.org/wiki/Run' })
    await openCard({ target: { kind: 'term', text: 'run', term: 'run', context: null } })
    await card('run').getByRole('tab', { name: 'Wikipedia' }).click()
    /** The ambiguous line is plain text in the panel. */
    await expect.element(panel.getByText('“Run” can mean several things on Wikipedia.')).toBeVisible()
    await expect
      .element(panel.getByRole('link', { name: 'See the choices on Wikipedia' }))
      .toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Run')
  })

  describe('errors', () => {
    it('says the dictionary is busy, and Retry looks the word up again', async () => {
      replies.word = () => json(503, { error: 'busy' })
      await openCard()
      await expectNotice(wordNotice('dictionary', 'busy').text)
      replies.word = wordReply
      await retry.click()
      await expect.element(panel.getByRole('heading', { name: 'Noun' })).toBeVisible()
      expect(sentTo(WORD_URL)).toHaveLength(2)
    })

    it('says a lookup that never arrived couldn’t reach the source', async () => {
      replies.word = () => Promise.reject(new TypeError('Failed to fetch'))
      await openCard()
      await expectNotice('Couldn’t reach Wiktionary.')
      await expect.element(retry).toBeVisible()
    })

    it('says the hourly limit is reached and when to try again, with no Retry', async () => {
      const retryAt = '2026-11-26T15:30:00.000Z'
      replies.word = () => json(429, { error: 'rate', retryAt })
      await openCard()
      await expectNotice(wordNotice('dictionary', 'rate', new Date(retryAt)).text)
      await expect.element(retry).not.toBeInTheDocument()
    })

    it('asks for a key before translating, naming the model’s provider', async () => {
      setupMock.getAskSetup.mockResolvedValue({ ...CLAUDE, model: 'gpt-6-luna', provider: 'openai', hasKey: false })
      await openCard()
      await tab('Translate').click()
      await expect.element(panel.getByText('Translating uses your own OpenAI key.')).toBeVisible()
      await expect.element(panel.getByRole('link', { name: 'Add a key' })).toHaveAttribute('href', '/account/api-keys')
      await expect.element(wordCard.getByText('Uses Ask with your OpenAI key.')).toBeVisible()
      expect(sentTo(TRANSLATE_URL)).toEqual([])
    })

    it('points to the API keys page when the key is rejected', async () => {
      localStorage.setItem(LOOKUP_PREFS_KEY, JSON.stringify({ to: 'de' }))
      replies.translate = () => json(401, { error: 'key_rejected' })
      await openCard()
      await tab('Translate').click()
      await expect.element(notice).toHaveRole('status')
      await expect.element(notice).toHaveTextContent('Anthropic rejected your key. Check it on the API keys page.')
      await expect
        .element(notice.getByRole('link', { name: 'API keys page' }))
        .toHaveAttribute('href', '/account/api-keys')
      await expect.element(retry).not.toBeInTheDocument()
    })

    it('says when a translation is refused or the account needs credit, with no Retry', async () => {
      localStorage.setItem(LOOKUP_PREFS_KEY, JSON.stringify({ to: 'de' }))
      replies.translate = () => json(422, { error: 'refused' })
      await openCard()
      await tab('Translate').click()
      await expectNotice('Claude didn’t translate this.')
      await expect.element(retry).not.toBeInTheDocument()

      replies.translate = () => json(402, { error: 'billing' })
      await panel.getByRole('combobox', { name: 'Translate to' }).selectOptions('es')
      await expectNotice('Your Anthropic account needs credit.')
    })

    it('says a translation failed, and Retry asks again', async () => {
      localStorage.setItem(LOOKUP_PREFS_KEY, JSON.stringify({ to: 'de' }))
      replies.translate = () => json(500, { error: 'failed' })
      await openCard()
      await tab('Translate').click()
      await expectNotice('Couldn’t translate that.')
      replies.translate = translateReply
      await retry.click()
      await expect.element(panel.getByText('sérendipité')).toBeVisible()
    })
  })

  it('asks a signed-out reader to sign in on every tab, and looks nothing up', async () => {
    await openCard({ signedIn: false })
    for (const name of ['Dictionary', 'Wikipedia', 'Translate']) {
      await tab(name).click()
      await expect.element(panel.getByText(SIGNED_OUT_TEXT)).toBeVisible()
      await expect
        .element(panel.getByRole('link', { name: 'Sign in' }))
        .toHaveAttribute('href', `/login?next=${encodeURIComponent(HREF)}`)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(setupMock.getAskSetup).not.toHaveBeenCalled()
  })

  it('opens a passage on Translate, with the passage folded until Show more', async () => {
    localStorage.setItem(LOOKUP_PREFS_KEY, JSON.stringify({ to: 'de' }))
    replies.translate = () => json(200, { translation: 'Es gibt einen Geist.', model: 'claude-opus-5-5' })
    await openCard({ target: PASSAGE })
    const passageCard = card('Translate passage')
    await expect.element(passageCard).toBeVisible()
    await expect.element(passageCard.getByRole('heading', { name: 'Translate passage' })).toHaveFocus()
    await expect.element(passageCard.getByRole('tablist')).not.toBeInTheDocument()
    await expect.element(passageCard.getByRole('button', { name: 'Explain in context' })).not.toBeInTheDocument()
    /** The passage is a blockquote, which has no accessible name. */
    const passage = passageCard.getByText(PASSAGE_TEXT)
    await expect.element(passage).toHaveClass('line-clamp-4')

    const more = passageCard.getByRole('button', { name: 'Show more' })
    await more.click()
    await expect.element(passage).not.toHaveClass('line-clamp-4')
    await passageCard.getByRole('button', { name: 'Show less' }).click()
    await expect.element(passage).toHaveClass('line-clamp-4')

    await expect.element(passageCard.getByText('Es gibt einen Geist.')).toBeVisible()
    expect(sentTo(TRANSLATE_URL)).toEqual([{ book: BOOK, text: PASSAGE_TEXT, to: 'de' }])
  })

  it('hands the word and its sentence to Explain in context', async () => {
    const onExplain = await openCard()
    await wordCard.getByRole('button', { name: 'Explain in context' }).click()
    expect(onExplain).toHaveBeenCalledWith('serendipity', CONTEXT)
  })

  it('turns Explain in context off while an answer is coming, and says why', async () => {
    const onExplain = await openCard({ explainDisabled: true })
    const explain = wordCard.getByRole('button', { name: 'Explain in context' })
    await expect.element(explain).toBeDisabled()
    await expect.element(explain).toHaveAccessibleDescription('Wait for the current answer to finish')
    expect(onExplain).not.toHaveBeenCalled()
  })

  describe('keyboard', () => {
    it('moves between the tabs with the arrow keys, and Enter or Space opens one', async () => {
      await openCard()
      await expect.element(wordCard.getByRole('heading', { name: 'serendipity' })).toHaveFocus()
      await userEvent.keyboard('{Tab}')
      await expect.element(wordCard.getByRole('button', { name: 'Close' })).toHaveFocus()
      await userEvent.keyboard('{Tab}')
      await expect.element(tab('Dictionary')).toHaveFocus()

      await userEvent.keyboard('{ArrowRight}')
      await expect.element(tab('Wikipedia')).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      await expect.element(tab('Wikipedia')).toHaveAttribute('aria-selected', 'true')
      await expect.element(panel.getByRole('heading', { name: 'Serendipity' })).toBeVisible()

      await userEvent.keyboard('{ArrowRight}')
      await expect.element(tab('Translate')).toHaveFocus()
      await userEvent.keyboard(' ')
      await expect.element(tab('Translate')).toHaveAttribute('aria-selected', 'true')
      await expect.element(panel.getByRole('combobox', { name: 'Translate to' })).toBeVisible()

      await userEvent.keyboard('{ArrowRight}')
      await expect.element(tab('Dictionary')).toHaveFocus()
      await userEvent.keyboard('{ArrowLeft}')
      await expect.element(tab('Translate')).toHaveFocus()
    })

    it('closes with Escape and puts focus back on the page', async () => {
      await openCard()
      await expect.element(wordCard.getByRole('heading', { name: 'serendipity' })).toHaveFocus()
      await userEvent.keyboard('{Escape}')
      await expect.element(wordCard).not.toBeInTheDocument()
      await expect.element(readerPage).toHaveFocus()
    })

    it('closes with Enter on its Close button', async () => {
      await openCard()
      await userEvent.keyboard('{Tab}')
      await expect.element(wordCard.getByRole('button', { name: 'Close' })).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      await expect.element(wordCard).not.toBeInTheDocument()
      await expect.element(readerPage).toHaveFocus()
    })

    it('opens as a bottom sheet on a phone, focused on the word, and Escape closes it', async () => {
      await page.viewport(390, 844)
      await openCard({ desktop: false })
      await expect.element(wordCard).toBeVisible()
      await expect.element(wordCard.getByRole('heading', { name: 'serendipity' })).toHaveFocus()
      await expect.element(panel.getByRole('heading', { name: 'Noun' })).toBeVisible()
      await userEvent.keyboard('{Escape}')
      await expect.element(wordCard).not.toBeInTheDocument()
      await expect.element(readerPage).toHaveFocus()
    })
  })
})
