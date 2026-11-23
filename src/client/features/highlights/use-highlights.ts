import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '~/client/components/Toast'
import { getBookHighlights } from '~/server/account-functions'
import { DEFAULT_COLOR, type HighlightColor } from '~/shared/highlights/colors'
import type { HighlightPlace, HighlightView } from '~/shared/highlights/group'
import { MAX_HIGHLIGHTS_PER_USER } from '~/shared/highlights/limits'
import type { PagePosition } from '~/shared/highlights/page-text'
import { highlightQuotaCopy } from '~/shared/plans/copy'
import { FREE_LIMITS } from '~/shared/plans/plans'
import type { HighlightProblem } from './highlights-client'
import * as client from './highlights-client'

export type HighlightsState = 'off' | 'signed_out' | 'loading' | 'ready' | 'unavailable'

export interface HighlightItem extends HighlightView {
  key: string
  pending: boolean
}

export const PROBLEM_TEXT: Record<HighlightProblem, string> = {
  'quota-book': 'You’ve reached 1,000 highlights in this book.',
  'quota-user': highlightQuotaCopy('pro', MAX_HIGHLIGHTS_PER_USER),
  'quota-free': highlightQuotaCopy('free', FREE_LIMITS.highlights),
  pro: 'Couldn’t save that. Try again.',
  stale: 'This page changed since it loaded. Reload it to highlight.',
  signed_out: 'You’ve been signed out. Sign in to keep highlights.',
  not_found: 'That highlight was already deleted.',
  failed: 'Couldn’t save that. Try again.',
}

const RELOAD_AFTER_MS = 60_000

export interface NewHighlight {
  position: PagePosition
  start: number
  end: number
  text: string
  place: Omit<HighlightPlace, 'href'>
}

const asItem = (h: HighlightView): HighlightItem => ({ ...h, key: h.id, pending: false })

export function useHighlights(book: string, { signedIn, embedded }: { signedIn: boolean; embedded: boolean }) {
  const toast = useToast()
  const enabled = signedIn && !embedded
  const [state, setState] = useState<HighlightsState>(embedded ? 'off' : signedIn ? 'loading' : 'signed_out')
  const [items, setItems] = useState<HighlightItem[]>([])
  const [color, setColor] = useState<HighlightColor>(DEFAULT_COLOR)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const ids = useRef(new Map<string, Promise<string | null>>())
  const counter = useRef(0)
  const generation = useRef(0)

  const load = useCallback(async () => {
    const asked = generation.current
    try {
      const answer = await getBookHighlights({ data: { book } })
      if (asked !== generation.current) return
      if (answer.state === 'ready') {
        setItems((now) => [...answer.highlights.map(asItem), ...now.filter((h) => h.pending)])
        setState('ready')
      } else setState(answer.state === 'signed_out' ? 'signed_out' : 'unavailable')
    } catch {
      if (asked === generation.current) setState('unavailable')
    }
  }, [book])

  useEffect(() => {
    generation.current++
    if (embedded) setState('off')
    else if (!signedIn) setState('signed_out')
    else {
      setItems([])
      setState('loading')
      void load()
    }
  }, [load, signedIn, embedded])

  useEffect(() => {
    if (!enabled) return
    let hiddenAt = 0
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else if (hiddenAt && Date.now() - hiddenAt >= RELOAD_AFTER_MS) void load()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [enabled, load])

  const failed = useCallback(
    (problem: HighlightProblem) => {
      toast(PROBLEM_TEXT[problem])
      if (problem === 'signed_out') setState('signed_out')
    },
    [toast],
  )

  const replace = useCallback(
    (key: string, next: HighlightItem | null) =>
      setItems((now) => (next ? now.map((h) => (h.key === key ? next : h)) : now.filter((h) => h.key !== key))),
    [],
  )

  const idOf = useCallback((key: string): Promise<string | null> => ids.current.get(key) ?? Promise.resolve(key), [])

  const create = useCallback(
    (input: NewHighlight): string => {
      const key = `new-${++counter.current}`
      const now = new Date().toISOString()
      const item: HighlightItem = {
        key,
        id: key,
        pending: true,
        color,
        note: null,
        text: input.text,
        status: 'ok',
        place: { ...input.place, href: input.place.pageHref },
        createdAt: now,
        updatedAt: now,
      }
      setItems((list) => [...list, item])
      const saved = client
        .createHighlight({
          book,
          position: input.position,
          start: input.start,
          end: input.end,
          text: input.text,
          color,
        })
        .then((result) => {
          if (!result.ok) {
            replace(key, null)
            failed(result.problem)
            return null
          }
          const current = itemsRef.current.find((h) => h.key === key)
          replace(key, {
            ...result.value,
            key,
            pending: false,
            color: current?.color ?? result.value.color,
            note: current ? current.note : result.value.note,
          })
          return result.value.id
        })
      ids.current.set(key, saved)
      return key
    },
    [book, color, failed, replace],
  )

  const change = useCallback(
    async (key: string, patch: { color?: HighlightColor; note?: string | null }): Promise<boolean> => {
      const before = itemsRef.current.find((h) => h.key === key)
      if (!before) return false
      replace(key, { ...before, ...patch })
      const id = await idOf(key)
      if (!id) return false
      const result = await client.updateHighlight(id, patch)
      if (result.ok) {
        replace(key, { ...result.value, key, pending: false })
        return true
      }
      replace(key, result.problem === 'not_found' ? null : before)
      failed(result.problem)
      return false
    },
    [failed, replace, idOf],
  )

  const recolor = useCallback(
    (key: string, next: HighlightColor) => {
      setColor(next)
      void change(key, { color: next })
    },
    [change],
  )

  const saveNote = useCallback(
    async (key: string, note: string): Promise<boolean> => {
      const text = note.trim()
      const ok = await change(key, { note: text || null })
      if (ok) toast('Note saved')
      return ok
    },
    [change, toast],
  )

  const remove = useCallback(
    async (key: string) => {
      const before = itemsRef.current.find((h) => h.key === key)
      if (!before) return
      replace(key, null)
      toast('Highlight deleted')
      const id = await idOf(key)
      if (!id) return
      const result = await client.deleteHighlight(id)
      if (result.ok) return
      if (result.problem !== 'not_found') setItems((now) => [...now, before])
      failed(result.problem)
    },
    [failed, toast, replace, idOf],
  )

  const retry = useCallback(() => {
    setState('loading')
    void load()
  }, [load])

  return { state, items, color, create, recolor, saveNote, remove, retry }
}

export type HighlightsApi = ReturnType<typeof useHighlights>
