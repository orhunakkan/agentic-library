import { useCallback, useEffect, useRef, useState } from 'react'
import { engineBase } from '~/shared/run-code/engines'
import type { RunLang } from '~/shared/run-code/langs'
import { hintFor, type RunStatus } from './run-messages'
import { FRAME_SANDBOX, frameHtml } from './sandbox/frame-source'
import { appendOutput, EMPTY_OUTPUT, type Output } from './sandbox/output'
import { ENGINE_LOAD_LIMIT, parseFrameMessage, RUN_TIME_LIMIT, type RunError } from './sandbox/protocol'
import { transpile } from './transpile'

export interface RunnerState {
  status: RunStatus
  output: Output
  error: RunError | null
  hint: string | null
  ms: number
}

const IDLE: RunnerState = { status: 'idle', output: EMPTY_OUTPUT, error: null, hint: null, ms: 0 }

interface Frame {
  el: HTMLIFrameElement
  ready: Promise<void>
  markReady: () => void
}

interface CurrentRun {
  id: string
  output: Output
  timer?: ReturnType<typeof setTimeout>
}

const warm = (lang: RunLang) => lang === 'python' || lang === 'sql'

export function useRunner(lang: RunLang) {
  const [state, setState] = useState<RunnerState>(IDLE)
  const frame = useRef<Frame | null>(null)
  const current = useRef<CurrentRun | null>(null)

  const removeFrame = useCallback(() => {
    frame.current?.el.remove()
    frame.current = null
  }, [])

  const end = useCallback(
    (status: RunStatus, keepFrame = false, extra: Partial<RunnerState> = {}) => {
      const run = current.current
      if (run?.timer) clearTimeout(run.timer)
      current.current = null
      if (!keepFrame) removeFrame()
      setState((s) => ({ ...s, ...extra, status, output: run?.output ?? s.output }))
    },
    [removeFrame],
  )

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const own = frame.current
      if (!own || event.source !== own.el.contentWindow) return
      const message = parseFrameMessage(event.data)
      if (!message) return
      if (message.kind === 'ready') {
        own.markReady()
        return
      }
      const run = current.current
      if (!run || message.id !== run.id) return
      switch (message.kind) {
        case 'loading':
          setState((s) => ({ ...s, status: 'loading' }))
          return
        case 'started':
          if (run.timer) clearTimeout(run.timer)
          run.timer = setTimeout(() => end('timeout'), RUN_TIME_LIMIT[lang])
          setState((s) => ({ ...s, status: 'running' }))
          return
        case 'output':
          run.output = appendOutput(run.output, message.entries)
          if (run.output.capped) end('capped')
          else setState((s) => ({ ...s, output: run.output }))
          return
        case 'done': {
          const error = message.error ?? null
          const hint = error ? hintFor(lang, error.message) : null
          end(error ? 'error' : 'done', warm(lang), { error, hint, ms: message.ms })
          return
        }
        case 'failed':
          end(message.reason === 'engine' ? 'engine_failed' : 'failed')
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      const run = current.current
      if (run?.timer) clearTimeout(run.timer)
      current.current = null
      removeFrame()
    }
  }, [lang, end, removeFrame])

  const makeFrame = useCallback((): Frame => {
    const el = document.createElement('iframe')
    el.setAttribute('sandbox', FRAME_SANDBOX)
    el.hidden = true
    el.title = 'Code runner'
    el.referrerPolicy = 'no-referrer'
    el.setAttribute('data-testid', 'run-frame')
    el.srcdoc = frameHtml(window.location.origin)
    let markReady = () => {}
    const ready = new Promise<void>((resolve) => {
      markReady = resolve
    })
    const made = { el, ready, markReady }
    frame.current = made
    document.body.append(el)
    return made
  }, [])

  const run = useCallback(
    async (code: string) => {
      if (current.current) end('stopped')
      const id = crypto.randomUUID()
      const started: CurrentRun = { id, output: EMPTY_OUTPUT }
      current.current = started
      setState({ ...IDLE, status: 'running' })
      let source = code
      if (lang === 'typescript') {
        const result = await transpile(code).catch(() => null)
        if (current.current !== started) return
        if (!result) return end('failed')
        if (!result.ok) {
          started.output = appendOutput(EMPTY_OUTPUT, [
            { t: 'line', level: 'error', text: result.error.message, indent: 0 },
          ])
          return end('error', false, { error: result.error, hint: null })
        }
        source = result.code
      }
      let own = warm(lang) ? frame.current : null
      if (!own) {
        removeFrame()
        own = makeFrame()
      }
      started.timer = setTimeout(() => end(warm(lang) ? 'engine_failed' : 'failed'), ENGINE_LOAD_LIMIT)
      await own.ready
      if (current.current !== started || frame.current !== own) return
      own.el.contentWindow?.postMessage(
        {
          kind: 'run',
          id,
          lang: lang === 'typescript' ? 'javascript' : lang,
          code: source,
          engineBase: warm(lang) ? engineBase(lang === 'python' ? 'python' : 'sqlite', window.location.origin) : '',
        },
        '*',
      )
    },
    [lang, end, makeFrame, removeFrame],
  )

  const stop = useCallback(() => {
    if (current.current) end('stopped')
  }, [end])

  const busy = state.status === 'running' || state.status === 'loading'
  return { ...state, busy, run, stop }
}
