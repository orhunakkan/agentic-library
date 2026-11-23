import type { TranslateAnswer, TranslateRequest, WordAnswer, WordRequest, WordSource } from '~/shared/lookup/contract'
import type { TranslateLanguage } from '~/shared/lookup/languages'
import { type LookupResult, lookUpWord, type TranslateProblem, translate, type WordProblem } from './lookup-client'

export interface LookupTarget {
  kind: 'term' | 'passage'
  text: string
  term: string | null
  context: string | null
  rect: DOMRect
}

export type LookupTab = WordSource | 'translate'

export type Loaded<T, P extends string> = { status: 'loading' } | ({ status: 'done' } & LookupResult<T, P>)

export const wordKey = (source: WordSource, lang: string, term: string) => `${source}|${lang}|${term}`
export const translateKey = (to: TranslateLanguage, text: string) => `${to}|${text}`

export const openingTab = (target: Pick<LookupTarget, 'kind'>): LookupTab =>
  target.kind === 'term' ? 'dictionary' : 'translate'

export function translationText(target: LookupTarget | null, term: string | null): string | null {
  if (!target) return null
  return target.kind === 'term' ? (term ?? target.text) : target.text
}

export type NextRequest =
  | { key: string; kind: 'word'; request: WordRequest }
  | { key: string; kind: 'translate'; request: TranslateRequest }

export interface CardView {
  book: string
  lang: string
  signedIn: boolean
  target: LookupTarget | null
  term: string | null
  tab: LookupTab
  to: TranslateLanguage | null
  canTranslate: boolean
}

export function nextRequest(view: CardView): NextRequest | null {
  const { target, term, tab, to } = view
  if (!target || !view.signedIn) return null
  if (tab !== 'translate')
    return term
      ? { key: wordKey(tab, view.lang, term), kind: 'word', request: { book: view.book, term, source: tab } }
      : null
  const text = translationText(target, term)
  if (!to || !view.canTranslate || !text) return null
  const context = target.kind === 'term' ? target.context : null
  return {
    key: translateKey(to, text),
    kind: 'translate',
    request: { book: view.book, text, ...(context ? { context } : {}), to },
  }
}

export interface CardState {
  target: LookupTarget | null
  term: string | null
  tab: LookupTab
  to: TranslateLanguage | null
}

export const CLOSED: CardState = { target: null, term: null, tab: 'dictionary', to: null }

export type CardAction =
  | { type: 'open'; target: LookupTarget; to: TranslateLanguage | null }
  | { type: 'close' }
  | { type: 'tab'; tab: LookupTab }
  | { type: 'lemma'; lemma: string }
  | { type: 'to'; to: TranslateLanguage }

export function cardReducer(state: CardState, action: CardAction): CardState {
  switch (action.type) {
    case 'open':
      return {
        target: action.target,
        term: action.target.term,
        tab: openingTab(action.target),
        to: state.to ?? action.to,
      }
    case 'close':
      return { ...state, target: null }
    case 'tab':
      return { ...state, tab: action.tab }
    case 'lemma':
      return { ...state, term: action.lemma, tab: 'dictionary' }
    case 'to':
      return { ...state, to: action.to }
  }
}

export class AnswerStore {
  private readonly answers = new Map<string, Loaded<unknown, string>>()

  constructor(private readonly changed: () => void) {}

  get<T, P extends string>(key: string): Loaded<T, P> | null {
    return (this.answers.get(key) as Loaded<T, P> | undefined) ?? null
  }

  word(source: WordSource, lang: string, term: string | null): Loaded<WordAnswer, WordProblem> | null {
    return term ? this.get(wordKey(source, lang, term)) : null
  }

  translation(to: TranslateLanguage | null, text: string | null): Loaded<TranslateAnswer, TranslateProblem> | null {
    return to && text ? this.get(translateKey(to, text)) : null
  }

  load<T, P extends string>(key: string, request: () => Promise<LookupResult<T, P>>): void {
    if (this.answers.has(key)) return
    this.answers.set(key, { status: 'loading' })
    this.changed()
    void request().then((result) => {
      this.answers.set(key, { status: 'done', ...result })
      this.changed()
    })
  }

  send(next: NextRequest | null, requests = { lookUpWord, translate }): void {
    if (next?.kind === 'word') this.load(next.key, () => requests.lookUpWord(next.request))
    else if (next?.kind === 'translate') this.load(next.key, () => requests.translate(next.request))
  }

  retry(): void {
    for (const [key, value] of this.answers) if (value.status === 'done' && !value.ok) this.answers.delete(key)
    this.changed()
  }
}
