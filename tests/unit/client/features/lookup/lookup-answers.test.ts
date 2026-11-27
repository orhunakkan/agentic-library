import { describe, expect, it, vi } from 'vitest'
import {
  AnswerStore,
  type CardView,
  CLOSED,
  cardReducer,
  type LookupTarget,
  nextRequest,
  openingTab,
  translateKey,
  translationText,
  wordKey,
} from '~/client/features/lookup/lookup-answers'

const rect = {} as DOMRect
const TERM: LookupTarget = { kind: 'term', text: 'chaise,', term: 'chaise', context: 'In a chaise and four.', rect }
const PASSAGE: LookupTarget = {
  kind: 'passage',
  text: 'It is a truth.\n\nUniversally.',
  term: null,
  context: null,
  rect,
}
const VIEW: CardView = {
  book: 'pride-and-prejudice',
  lang: 'en',
  signedIn: true,
  target: TERM,
  term: 'chaise',
  tab: 'dictionary',
  to: 'tr',
  canTranslate: true,
}

describe('the card’s requests', () => {
  it('opens a term on Dictionary and a passage on its translation', () => {
    expect(openingTab(TERM)).toBe('dictionary')
    expect(openingTab(PASSAGE)).toBe('translate')
  })

  it('asks for the tab shown, by source, language and term', () => {
    expect(nextRequest(VIEW)).toEqual({
      key: 'dictionary|en|chaise',
      kind: 'word',
      request: { book: 'pride-and-prejudice', term: 'chaise', source: 'dictionary' },
    })
    expect(nextRequest({ ...VIEW, tab: 'wikipedia', term: 'acknowledge' })?.key).toBe(
      wordKey('wikipedia', 'en', 'acknowledge'),
    )
  })

  it('translates the term shown with its sentence, and a passage as selected without one', () => {
    expect(nextRequest({ ...VIEW, tab: 'translate' })).toEqual({
      key: 'tr|chaise',
      kind: 'translate',
      request: { book: 'pride-and-prejudice', text: 'chaise', context: 'In a chaise and four.', to: 'tr' },
    })
    expect(nextRequest({ ...VIEW, target: PASSAGE, term: null, tab: 'translate', to: 'de' })).toEqual({
      key: translateKey('de', PASSAGE.text),
      kind: 'translate',
      request: { book: 'pride-and-prejudice', text: PASSAGE.text, to: 'de' },
    })
    expect(nextRequest({ ...VIEW, target: { ...TERM, context: null }, tab: 'translate' })?.request).not.toHaveProperty(
      'context',
    )
  })

  it('asks for nothing when closed, signed out, without a target language or key, or without a term', () => {
    expect(nextRequest({ ...VIEW, target: null })).toBeNull()
    expect(nextRequest({ ...VIEW, signedIn: false })).toBeNull()
    expect(nextRequest({ ...VIEW, tab: 'translate', to: null })).toBeNull()
    expect(nextRequest({ ...VIEW, tab: 'translate', canTranslate: false })).toBeNull()
    expect(nextRequest({ ...VIEW, term: null })).toBeNull()
  })

  it('translates the term shown, or the selection when there is none', () => {
    expect(translationText(TERM, 'acknowledge')).toBe('acknowledge')
    expect(translationText(TERM, null)).toBe('chaise,')
    expect(translationText(PASSAGE, null)).toBe(PASSAGE.text)
    expect(translationText(null, 'x')).toBeNull()
  })
})

describe('AnswerStore', () => {
  const found = { state: 'not-found' } as const

  it('sends once per key, holds the answer, and says when it changes', async () => {
    const changed = vi.fn()
    const store = new AnswerStore(changed)
    const request = vi.fn(async () => ({ ok: true as const, value: found }))
    store.load(wordKey('dictionary', 'en', 'chaise'), request)
    expect(store.word('dictionary', 'en', 'chaise')).toEqual({ status: 'loading' })
    store.load(wordKey('dictionary', 'en', 'chaise'), request)
    await vi.waitFor(() => expect(store.word('dictionary', 'en', 'chaise')).toMatchObject({ status: 'done', ok: true }))
    store.load(wordKey('dictionary', 'en', 'chaise'), request)
    expect(request).toHaveBeenCalledOnce()
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('forgets failures on retry and keeps answers', async () => {
    const store = new AnswerStore(() => {})
    store.load(translateKey('tr', 'chaise'), async () => ({ ok: false as const, problem: 'busy' as const }))
    store.load(wordKey('wikipedia', 'en', 'chaise'), async () => ({ ok: true as const, value: found }))
    await vi.waitFor(() => expect(store.translation('tr', 'chaise')).toMatchObject({ status: 'done' }))
    await vi.waitFor(() => expect(store.word('wikipedia', 'en', 'chaise')).toMatchObject({ status: 'done' }))
    store.retry()
    expect(store.translation('tr', 'chaise')).toBeNull()
    expect(store.word('wikipedia', 'en', 'chaise')).toMatchObject({ ok: true })
  })

  it('holds nothing for a missing term, target or text', () => {
    const store = new AnswerStore(() => {})
    expect(store.word('dictionary', 'en', null)).toBeNull()
    expect(store.translation(null, 'chaise')).toBeNull()
    expect(store.translation('tr', null)).toBeNull()
    expect(store.get('nothing')).toBeNull()
  })
})

describe('cardReducer', () => {
  it('opens on a selection, keeping a target already chosen over the default', () => {
    const opened = cardReducer(CLOSED, { type: 'open', target: TERM, to: 'tr' })
    expect(opened).toEqual({ target: TERM, term: 'chaise', tab: 'dictionary', to: 'tr' })
    const chosen = cardReducer({ ...opened, to: 'de' }, { type: 'open', target: PASSAGE, to: 'tr' })
    expect(chosen).toEqual({ target: PASSAGE, term: null, tab: 'translate', to: 'de' })
    expect(cardReducer(CLOSED, { type: 'open', target: TERM, to: null }).to).toBeNull()
  })

  it('changes tab, follows a lemma back to Dictionary, picks a target and closes, keeping the target', () => {
    let state = cardReducer(CLOSED, { type: 'open', target: TERM, to: null })
    state = cardReducer(state, { type: 'tab', tab: 'wikipedia' })
    expect(state.tab).toBe('wikipedia')
    state = cardReducer(state, { type: 'lemma', lemma: 'acknowledge' })
    expect(state).toMatchObject({ term: 'acknowledge', tab: 'dictionary' })
    state = cardReducer(state, { type: 'to', to: 'fr' })
    expect(state.to).toBe('fr')
    expect(cardReducer(state, { type: 'close' })).toMatchObject({ target: null, to: 'fr' })
  })
})

describe('AnswerStore.send', () => {
  it('sends the request the card needs, and nothing when it needs none', async () => {
    const store = new AnswerStore(() => {})
    const requests = {
      lookUpWord: vi.fn(async () => ({ ok: true as const, value: { state: 'not-found' as const } })),
      translate: vi.fn(async () => ({ ok: true as const, value: { translation: '[tr] chaise', model: 'm' } })),
    }
    store.send(nextRequest(VIEW), requests)
    store.send(nextRequest({ ...VIEW, tab: 'translate' }), requests)
    store.send(null, requests)
    expect(requests.lookUpWord).toHaveBeenCalledWith({
      book: 'pride-and-prejudice',
      term: 'chaise',
      source: 'dictionary',
    })
    expect(requests.translate).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(store.translation('tr', 'chaise')).toMatchObject({ ok: true }))
  })
})
