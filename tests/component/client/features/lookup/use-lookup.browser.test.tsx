import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import type { LookupResult, TranslateProblem, WordProblem } from '~/client/features/lookup/lookup-client'
import { LOOKUP_PREFS_KEY } from '~/client/features/lookup/lookup-prefs'
import { type LookupTarget, type Setup, useLookup } from '~/client/features/lookup/use-lookup'
import type { TranslateAnswer, TranslateErrorCode, WordAnswer, WordErrorCode } from '~/shared/lookup/contract'
import type { ErrorAnswer } from '../../../../support/client/answers'
import { mountHook } from '../../../../support/client/mount'

/** The setup the hook loads for Translate, from a server function that imports TanStack Start. */
const server = vi.hoisted(() => ({ getAskSetup: vi.fn() }))
vi.mock('~/server/account-functions', () => server)

const WORD_URL = '/account/lookup/word'
const TRANSLATE_URL = '/account/lookup/translate'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
/** The word route's answers, typed by its contract so a renamed code or field fails the typecheck. */
const wordJson = (status: number, body: WordAnswer | ErrorAnswer<WordErrorCode>) => json(status, body)
/** The translate route's answers, typed the same way. */
const translateJson = (status: number, body: TranslateAnswer | ErrorAnswer<TranslateErrorCode>) => json(status, body)

/** The network: each test says what the lookup routes answer, and a request it didn't expect gets no answer. */
let fetchSpy: MockInstance<typeof fetch>

/** The JSON bodies of the requests sent to `path`, in order. */
const sentTo = (path: string) =>
  fetchSpy.mock.calls
    .filter(([url]) => String(url) === path)
    .map(([, init]) => JSON.parse(String(init?.body)) as unknown)

type WordResult = LookupResult<WordAnswer, WordProblem>
type TranslateResult = LookupResult<TranslateAnswer, TranslateProblem>

const withKey: Setup = {
  signedIn: true,
  hasKey: true,
  keys: { anthropic: true, openai: false },
  model: 'claude-opus-5-5',
  provider: 'anthropic',
  prompts: [],
}

/** The dictionary's answer for a word it has no entry for, and what the hook shows for it. */
const noEntry: WordAnswer = { state: 'not-found' }
const notFound: WordResult = { ok: true, value: noEntry }

const term = (text: string): LookupTarget => ({
  kind: 'term',
  text,
  term: text,
  context: `A sentence with ${text} in it.`,
  rect: new DOMRect(0, 0, 40, 16),
})

const passage: LookupTarget = {
  kind: 'passage',
  text: 'Ein ganzer Satz.',
  term: null,
  context: null,
  rect: new DOMRect(0, 0, 200, 16),
}

interface Props {
  book: string
  lang: string
  signedIn: boolean
}

/** The hook, with the answers it shows read in the same render, so a test sees them only once the hook re-renders. */
function useLookupShown(props: Props) {
  const state = useLookup(props)
  return {
    ...state,
    word: state.store.word('dictionary', props.lang, state.term),
    translation: state.store.translation(state.to, state.target?.text ?? null),
  }
}

const signedIn: Props = { book: 'a-book', lang: 'de', signedIn: true }

beforeEach(() => {
  localStorage.removeItem(LOOKUP_PREFS_KEY)
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No answer for this request'))
})

describe('useLookup', () => {
  it('starts closed, without asking the server anything', () => {
    const hook = mountHook(useLookupShown, signedIn)
    expect(hook.current).toMatchObject({ target: null, term: null, setup: null, lang: 'de', word: null })
    expect(server.getAskSetup).not.toHaveBeenCalled()
    expect(sentTo(WORD_URL)).toEqual([])
  })

  it('looks a word up when it opens on one, and shows the answer when it comes', async () => {
    server.getAskSetup.mockResolvedValue(withKey)
    const answer = Promise.withResolvers<Response>()
    fetchSpy.mockReturnValue(answer.promise)
    const hook = mountHook(useLookupShown, signedIn)

    hook.current.open(term('Haus'))

    await vi.waitFor(() => expect(hook.current.word).toEqual({ status: 'loading' }))
    expect(hook.current).toMatchObject({ term: 'Haus', tab: 'dictionary' })
    expect(sentTo(WORD_URL)).toContainEqual({ book: 'a-book', term: 'Haus', source: 'dictionary' })
    answer.resolve(wordJson(200, noEntry))
    await vi.waitFor(() => expect(hook.current.word).toEqual({ status: 'done', ...notFound }))
    await vi.waitFor(() => expect(hook.current.setup).toEqual(withKey))
  })

  it('asks for the setup once, however often it opens', async () => {
    server.getAskSetup.mockResolvedValue(withKey)
    /** A fresh answer for each request, as a body can be read only once. */
    fetchSpy.mockImplementation(async () => wordJson(200, noEntry))
    const hook = mountHook(useLookupShown, signedIn)

    hook.current.open(term('Haus'))
    await vi.waitFor(() => expect(hook.current.setup).toEqual(withKey))
    hook.current.dispatch({ type: 'close' })
    hook.current.open(term('Baum'))
    await vi.waitFor(() => expect(hook.current.word?.status).toBe('done'))

    expect(server.getAskSetup).toHaveBeenCalledTimes(1)
  })

  it('treats a setup that fails to load as signed out, so it never translates', async () => {
    server.getAskSetup.mockRejectedValue(new Error('offline'))
    const hook = mountHook(useLookupShown, signedIn)

    hook.current.open(passage)

    await vi.waitFor(() => expect(hook.current.setup).toEqual({ signedIn: false }))
    expect(hook.current.tab).toBe('translate')
    expect(sentTo(TRANSLATE_URL)).toEqual([])
  })

  it('translates a passage into the saved language once the setup says a key is saved', async () => {
    localStorage.setItem(LOOKUP_PREFS_KEY, JSON.stringify({ to: 'fr' }))
    const setup = Promise.withResolvers<Setup>()
    server.getAskSetup.mockReturnValue(setup.promise)
    const translated = { translation: 'Une phrase entière.', model: 'm' } satisfies TranslateAnswer
    const translation: TranslateResult = { ok: true, value: translated }
    fetchSpy.mockImplementation(async () => translateJson(200, translated))
    const hook = mountHook(useLookupShown, signedIn)

    hook.current.open(passage)
    await vi.waitFor(() => expect(hook.current.to).toBe('fr'))
    expect(sentTo(TRANSLATE_URL)).toEqual([])

    setup.resolve(withKey)
    await vi.waitFor(() => expect(hook.current.translation).toEqual({ status: 'done', ...translation }))
    expect(sentTo(TRANSLATE_URL)).toContainEqual({ book: 'a-book', text: 'Ein ganzer Satz.', to: 'fr' })
  })

  it('looks nothing up, and loads no setup, for a reader who is signed out', async () => {
    const hook = mountHook(useLookupShown, { ...signedIn, signedIn: false })

    hook.current.open(term('Haus'))

    await vi.waitFor(() => expect(hook.current.term).toBe('Haus'))
    expect(hook.current.word).toBeNull()
    expect(server.getAskSetup).not.toHaveBeenCalled()
    expect(sentTo(WORD_URL)).toEqual([])
  })

  it('keeps showing the current word when an earlier one is answered late', async () => {
    server.getAskSetup.mockResolvedValue(withKey)
    const earlier = Promise.withResolvers<Response>()
    const current = Promise.withResolvers<Response>()
    fetchSpy.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(current.promise)
    const hook = mountHook(useLookupShown, signedIn)

    hook.current.open(term('Häuser'))
    await vi.waitFor(() => expect(sentTo(WORD_URL)).toHaveLength(1))
    hook.current.dispatch({ type: 'lemma', lemma: 'Haus' })
    await vi.waitFor(() => expect(sentTo(WORD_URL)).toHaveLength(2))

    earlier.resolve(wordJson(503, { error: 'busy' }))
    await vi.waitFor(() => expect(hook.current.store.word('dictionary', 'de', 'Häuser')?.status).toBe('done'))
    expect(hook.current.term).toBe('Haus')
    expect(hook.current.word).toEqual({ status: 'loading' })

    current.resolve(wordJson(200, noEntry))
    await vi.waitFor(() => expect(hook.current.word).toEqual({ status: 'done', ...notFound }))
  })

  it('looks a word up again only after a retry, once its lookup failed', async () => {
    server.getAskSetup.mockResolvedValue(withKey)
    /** The first request never reaches the server, as when the reader is offline. */
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(wordJson(200, noEntry))
    const hook = mountHook(useLookupShown, signedIn)

    hook.current.open(term('Haus'))
    await vi.waitFor(() => expect(hook.current.word).toMatchObject({ status: 'done', ok: false }))
    hook.rerender({ ...signedIn })
    expect(sentTo(WORD_URL)).toHaveLength(1)

    hook.current.store.retry()
    await vi.waitFor(() => expect(hook.current.word).toEqual({ status: 'done', ...notFound }))
    expect(sentTo(WORD_URL)).toHaveLength(2)
  })
})
