import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LookupResult, TranslateProblem, WordProblem } from '~/client/features/lookup/lookup-client'
import { LOOKUP_PREFS_KEY } from '~/client/features/lookup/lookup-prefs'
import { type LookupTarget, type Setup, useLookup } from '~/client/features/lookup/use-lookup'
import type { TranslateAnswer, WordAnswer } from '~/shared/lookup/contract'
import { mountHook } from '../../../../support/client/mount'

/** The setup the hook loads for Translate, from a server function that imports TanStack Start. */
const server = vi.hoisted(() => ({ getAskSetup: vi.fn() }))
vi.mock('~/server/account-functions', () => server)

/** The lookups the hook's answer store sends, answered by each test. */
const lookups = vi.hoisted(() => ({ lookUpWord: vi.fn(), translate: vi.fn() }))
vi.mock('~/client/features/lookup/lookup-client', () => lookups)

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

const notFound: WordResult = { ok: true, value: { state: 'not-found' } }

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
})

describe('useLookup', () => {
  it('starts closed, without asking the server anything', () => {
    const hook = mountHook(useLookupShown, signedIn)
    expect(hook.current).toMatchObject({ target: null, term: null, setup: null, lang: 'de', word: null })
    expect(server.getAskSetup).not.toHaveBeenCalled()
    expect(lookups.lookUpWord).not.toHaveBeenCalled()
  })

  it('looks a word up when it opens on one, and shows the answer when it comes', async () => {
    server.getAskSetup.mockResolvedValue(withKey)
    const answer = Promise.withResolvers<WordResult>()
    lookups.lookUpWord.mockReturnValue(answer.promise)
    const hook = mountHook(useLookupShown, signedIn)

    hook.current.open(term('Haus'))

    await vi.waitFor(() => expect(hook.current.word).toEqual({ status: 'loading' }))
    expect(hook.current).toMatchObject({ term: 'Haus', tab: 'dictionary' })
    expect(lookups.lookUpWord).toHaveBeenCalledWith({ book: 'a-book', term: 'Haus', source: 'dictionary' })
    answer.resolve(notFound)
    await vi.waitFor(() => expect(hook.current.word).toEqual({ status: 'done', ...notFound }))
    await vi.waitFor(() => expect(hook.current.setup).toEqual(withKey))
  })

  it('asks for the setup once, however often it opens', async () => {
    server.getAskSetup.mockResolvedValue(withKey)
    lookups.lookUpWord.mockResolvedValue(notFound)
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
    expect(lookups.translate).not.toHaveBeenCalled()
  })

  it('translates a passage into the saved language once the setup says a key is saved', async () => {
    localStorage.setItem(LOOKUP_PREFS_KEY, JSON.stringify({ to: 'fr' }))
    const setup = Promise.withResolvers<Setup>()
    server.getAskSetup.mockReturnValue(setup.promise)
    const translation: TranslateResult = { ok: true, value: { translation: 'Une phrase entière.', model: 'm' } }
    lookups.translate.mockResolvedValue(translation)
    const hook = mountHook(useLookupShown, signedIn)

    hook.current.open(passage)
    await vi.waitFor(() => expect(hook.current.to).toBe('fr'))
    expect(lookups.translate).not.toHaveBeenCalled()

    setup.resolve(withKey)
    await vi.waitFor(() => expect(hook.current.translation).toEqual({ status: 'done', ...translation }))
    expect(lookups.translate).toHaveBeenCalledWith({ book: 'a-book', text: 'Ein ganzer Satz.', to: 'fr' })
  })

  it('looks nothing up, and loads no setup, for a reader who is signed out', async () => {
    const hook = mountHook(useLookupShown, { ...signedIn, signedIn: false })

    hook.current.open(term('Haus'))

    await vi.waitFor(() => expect(hook.current.term).toBe('Haus'))
    expect(hook.current.word).toBeNull()
    expect(server.getAskSetup).not.toHaveBeenCalled()
    expect(lookups.lookUpWord).not.toHaveBeenCalled()
  })

  it('keeps showing the current word when an earlier one is answered late', async () => {
    server.getAskSetup.mockResolvedValue(withKey)
    const earlier = Promise.withResolvers<WordResult>()
    const current = Promise.withResolvers<WordResult>()
    lookups.lookUpWord.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(current.promise)
    const hook = mountHook(useLookupShown, signedIn)

    hook.current.open(term('Häuser'))
    await vi.waitFor(() => expect(lookups.lookUpWord).toHaveBeenCalledTimes(1))
    hook.current.dispatch({ type: 'lemma', lemma: 'Haus' })
    await vi.waitFor(() => expect(lookups.lookUpWord).toHaveBeenCalledTimes(2))

    earlier.resolve({ ok: false, problem: 'busy' })
    await vi.waitFor(() => expect(hook.current.store.word('dictionary', 'de', 'Häuser')?.status).toBe('done'))
    expect(hook.current.term).toBe('Haus')
    expect(hook.current.word).toEqual({ status: 'loading' })

    current.resolve(notFound)
    await vi.waitFor(() => expect(hook.current.word).toEqual({ status: 'done', ...notFound }))
  })

  it('looks a word up again only after a retry, once its lookup failed', async () => {
    server.getAskSetup.mockResolvedValue(withKey)
    lookups.lookUpWord.mockResolvedValueOnce({ ok: false, problem: 'network' }).mockResolvedValueOnce(notFound)
    const hook = mountHook(useLookupShown, signedIn)

    hook.current.open(term('Haus'))
    await vi.waitFor(() => expect(hook.current.word).toMatchObject({ status: 'done', ok: false }))
    hook.rerender({ ...signedIn })
    expect(lookups.lookUpWord).toHaveBeenCalledTimes(1)

    hook.current.store.retry()
    await vi.waitFor(() => expect(hook.current.word).toEqual({ status: 'done', ...notFound }))
    expect(lookups.lookUpWord).toHaveBeenCalledTimes(2)
  })
})
