import { useCallback, useEffect, useRef, useState } from 'react'
import type { PagePosition } from '~/shared/content/position'
import { citationMarker, cleanModelText } from './answer-format'
import { type AskAction, type AskProblem, historyFor, isStudyAction, sendQuestion } from './ask-client'
import { newQuiz, pick as pickIn, studyText } from './study'
import {
  browserStorage,
  clearThread,
  emptyThread,
  loadThread,
  saveThread,
  type Thread,
  type ThreadCitation,
  type ThreadStudy,
  type ThreadTurn,
} from './thread-store'

export interface PendingAnswer {
  question: string
  quote: string | null
  action: AskAction | null
  text: string
  citations: ThreadCitation[]
}

export interface AskFailure {
  problem: AskProblem
  retryAt?: string
  question: string
  quote: string | null
  highlights: boolean
  action: AskAction | null
  prompt: string | null
}

const STREAM_ERRORS: readonly AskProblem[] = ['key_rejected', 'billing', 'busy', 'too_long', 'bad_format', 'failed']

export function useAsk(bookSlug: string, position: PagePosition) {
  const [thread, setThread] = useState<Thread>(emptyThread)
  const [pending, setPending] = useState<PendingAnswer | null>(null)
  const [failure, setFailure] = useState<AskFailure | null>(null)
  const abort = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const threadRef = useRef(thread)
  threadRef.current = thread
  const positionRef = useRef(position)
  positionRef.current = position

  useEffect(() => {
    generation.current++
    abort.current?.abort()
    setThread(loadThread(browserStorage(), bookSlug))
    setPending(null)
    setFailure(null)
  }, [bookSlug])

  useEffect(() => () => abort.current?.abort(), [])

  const store = useCallback(
    (next: Thread) => {
      setThread(next)
      saveThread(browserStorage(), bookSlug, next)
    },
    [bookSlug],
  )

  const ask = useCallback(
    async (
      question: string,
      quote: string | null = null,
      options: { highlights?: boolean; action?: AskAction | null; prompt?: string | null; spoken?: boolean } = {},
    ) => {
      const highlights = options.highlights === true
      const action = options.action ?? null
      const prompt = options.prompt ?? null
      const text = question.trim()
      if (!text || abort.current) return
      const controller = new AbortController()
      abort.current = controller
      const mine = generation.current
      setFailure(null)
      const answer: PendingAnswer = { question: text, quote, action, text: '', citations: [] }
      const studying = isStudyAction(action)
      let study: ThreadStudy | null = null
      setPending({ ...answer })
      const asked: ThreadTurn = {
        role: 'user',
        text: quote ? `“${quote}”\n\n${text}` : text,
        citations: [],
        at: Date.now(),
      }
      const keep = (stopped: boolean) => {
        if (generation.current !== mine) return
        const turns = [...threadRef.current.turns, asked]
        if (study) {
          turns.push({ role: 'assistant', text: studyText(study), citations: [], at: Date.now(), study })
        } else if (studying && stopped) {
          turns.push({ role: 'assistant', text: '', citations: [], at: Date.now(), stopped: true })
        } else if (answer.text.trim()) {
          turns.push({
            role: 'assistant',
            text: answer.text,
            citations: answer.citations,
            at: Date.now(),
            ...(stopped ? { stopped: true as const } : {}),
          })
        }
        store({ ...threadRef.current, turns })
      }
      const fail = (problem: AskProblem, retryAt?: string) => {
        if (generation.current === mine)
          setFailure({ problem, question: text, quote, highlights, action, prompt, ...(retryAt ? { retryAt } : {}) })
      }
      try {
        const result = await sendQuestion(
          bookSlug,
          {
            position: positionRef.current,
            wholeBook: threadRef.current.wholeBook,
            question: text,
            quote,
            history: historyFor(threadRef.current.turns),
            ...(highlights ? { highlights: true as const } : {}),
            ...(action ? { action } : {}),
            ...(prompt ? { prompt } : {}),
            ...(options.spoken ? { spoken: true as const } : {}),
          },
          controller.signal,
        )
        if (!result.ok) {
          fail(result.problem, result.retryAt)
          return
        }
        let finished = false
        for await (const event of result.events) {
          if (event.type === 'text') answer.text += cleanModelText(event.text)
          else if (event.type === 'quiz') study = newQuiz(event.span, event.questions)
          else if (event.type === 'cards') study = { kind: 'cards', span: event.span, cards: event.cards }
          else if (event.type === 'citation') {
            answer.text += citationMarker(answer.citations.length)
            answer.citations.push({ pageHref: event.pageHref, label: event.label, citedText: event.citedText })
          } else if (event.type === 'error') {
            fail(STREAM_ERRORS.find((p) => p === event.code) ?? 'failed')
            finished = true
            break
          } else if (event.type === 'done') {
            if (event.stop === 'refusal') fail('refusal')
            else if (studying && !study) fail('failed')
            else keep(false)
            finished = true
            break
          }
          setPending({ ...answer, citations: [...answer.citations] })
        }
        if (!finished) fail('failed')
      } catch {
        if (controller.signal.aborted) keep(true)
        else fail('failed')
      } finally {
        abort.current = null
        setPending(null)
      }
    },
    [bookSlug, store],
  )

  const stop = useCallback(() => abort.current?.abort(), [])

  const retry = useCallback(() => {
    if (failure)
      void ask(failure.question, failure.quote, {
        highlights: failure.highlights,
        action: failure.action,
        prompt: failure.prompt,
      })
  }, [ask, failure])

  const pick = useCallback(
    (turnIndex: number, question: number, choice: number) => {
      const current = threadRef.current
      const turn = current.turns[turnIndex]
      if (!turn?.study) return
      const study = pickIn(turn.study, question, choice)
      if (study === turn.study) return
      store({ ...current, turns: current.turns.map((t, i) => (i === turnIndex ? { ...t, study } : t)) })
    },
    [store],
  )

  const clear = useCallback(() => {
    generation.current++
    abort.current?.abort()
    clearThread(browserStorage(), bookSlug)
    setThread((t) => ({ v: 1, wholeBook: t.wholeBook, turns: [] }))
    setFailure(null)
  }, [bookSlug])

  const setWholeBook = useCallback((wholeBook: boolean) => store({ ...threadRef.current, wholeBook }), [store])

  return { thread, pending, failure, ask, stop, retry, clear, setWholeBook, pick, busy: pending !== null }
}
