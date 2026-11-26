import { type Dispatch, useEffect, useMemo, useReducer, useState } from 'react'
import { getAskSetup } from '~/server/account-functions'
import { defaultTarget } from '~/shared/lookup/languages'
import {
  AnswerStore,
  type CardAction,
  type CardState,
  CLOSED,
  cardReducer,
  type LookupTarget,
  nextRequest,
} from './lookup-answers'
import { readTarget } from './lookup-prefs'

export type { Loaded, LookupTab, LookupTarget } from './lookup-answers'

export type Setup = Awaited<ReturnType<typeof getAskSetup>>

export interface LookupState extends CardState {
  dispatch: Dispatch<CardAction>
  store: AnswerStore
  lang: string
  setup: Setup | null
  open: (target: LookupTarget) => void
}

export function useLookup({ book, lang, signedIn }: { book: string; lang: string; signedIn: boolean }): LookupState {
  const [card, dispatch] = useReducer(cardReducer, CLOSED)
  const [setup, setSetup] = useState<Setup | null>(null)
  const [asked, setAsked] = useState(false)
  const [, setVersion] = useState(0)
  const store = useMemo(() => new AnswerStore(() => setVersion((v) => v + 1)), [])

  useEffect(() => {
    if (!card.target || !signedIn || asked) return
    setAsked(true)
    getAskSetup()
      .then(setSetup)
      .catch(() => setSetup({ signedIn: false }))
  }, [card.target, signedIn, asked])

  const canTranslate = setup?.signedIn === true && setup.hasKey
  const next = nextRequest({ book, lang, signedIn, canTranslate, ...card })
  useEffect(() => store.send(next))

  const open = (target: LookupTarget) =>
    dispatch({ type: 'open', target, to: readTarget() ?? defaultTarget(navigator.languages ?? [], lang) })
  return { ...card, dispatch, store, lang, setup, open }
}
