import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { mountHook } from '~/client/testing/mount'
import { HINTS } from './run-messages'
import { RUN_TIME_LIMIT } from './sandbox/protocol'
import { useRunner } from './use-runner'

/**
 * The code runs for real, in the sandboxed frame and worker the hook makes. The frame is hidden and has no role, so it
 * is found as an element, and its title, the name it would have, is checked where it's first found.
 */
const frames = () => [...document.querySelectorAll('iframe')]

function onlyFrame(): HTMLIFrameElement {
  const [frame, ...others] = frames()
  if (!frame || others.length) throw new Error(`Expected one frame, found ${frames().length}`)
  return frame
}

/** Resolves when the hook's frame posts a message of this kind, which reaches the hook's own listener first. */
function frameSays(kind: string): Promise<void> {
  const said = Promise.withResolvers<void>()
  const listen = (event: MessageEvent) => {
    const frame = frames()[0]
    const data: unknown = event.data
    if (frame && event.source === frame.contentWindow && typeof data === 'object' && data && 'kind' in data)
      if (data.kind === kind) said.resolve()
  }
  window.addEventListener('message', listen)
  onTestFinished(() => window.removeEventListener('message', listen))
  return said.promise
}

/** Fakes only the page's timers, so the frame's own clock and Vitest's waiting run as usual. */
function fakeTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
}

const NEVER_ENDS = 'for (;;) {}'

/** Long enough for a frame, its worker and, for TypeScript, the transpiler to start on a busy machine. */
const RUN_WAIT = { timeout: 10_000 }

describe('useRunner', () => {
  it('starts idle, with no frame on the page', () => {
    const hook = mountHook(useRunner, 'javascript')
    expect(hook.current).toMatchObject({ status: 'idle', busy: false, error: null, hint: null, ms: 0 })
    expect(hook.current.output.shown).toEqual([])
    expect(frames()).toEqual([])
  })

  it('runs JavaScript in a hidden sandboxed frame, shows what it logged, then removes the frame', async () => {
    const hook = mountHook(useRunner, 'javascript')

    void hook.current.run('console.log("hello", 1 + 1)')

    const frame = onlyFrame()
    expect(frame.title).toBe('Code runner')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.hidden).toBe(true)
    expect(frame.referrerPolicy).toBe('no-referrer')

    await vi.waitFor(() => expect(hook.current.status).toBe('done'), RUN_WAIT)
    expect(hook.current.busy).toBe(false)
    expect(hook.current.output.shown).toEqual([{ t: 'line', level: 'log', text: 'hello 2', indent: 0 }])
    expect(hook.current.error).toBeNull()
    expect(hook.current.ms).toBeGreaterThanOrEqual(0)
    expect(frame.isConnected).toBe(false)
  })

  it('reports an uncaught error with its line and a hint for the language', async () => {
    const hook = mountHook(useRunner, 'javascript')

    void hook.current.run('console.log("before")\nrequire("fs")')

    await vi.waitFor(() => expect(hook.current.status).toBe('error'), RUN_WAIT)
    expect(hook.current.error).toEqual({ message: 'ReferenceError: require is not defined', line: 2 })
    expect(hook.current.hint).toBe(HINTS.node)
    expect(hook.current.output.shown.map((entry) => entry.t === 'line' && entry.text)).toEqual([
      'before',
      'ReferenceError: require is not defined',
    ])
    expect(frames()).toEqual([])
  })

  it('runs TypeScript as JavaScript once its types are removed', async () => {
    const hook = mountHook(useRunner, 'typescript')

    void hook.current.run('const total: number = 2 + 3\nconsole.log(total)')

    await vi.waitFor(() => expect(hook.current.status).toBe('done'), RUN_WAIT)
    expect(hook.current.output.shown).toEqual([{ t: 'line', level: 'log', text: '5', indent: 0 }])
  })

  it('reports TypeScript that will not parse without making a frame', async () => {
    const hook = mountHook(useRunner, 'typescript')
    const append = vi.spyOn(document.body, 'append')

    void hook.current.run('const total: = 2')

    await vi.waitFor(() => expect(hook.current.status).toBe('error'), RUN_WAIT)
    expect(hook.current.error?.message).toMatch(/^SyntaxError/)
    expect(hook.current.output.shown).toMatchObject([{ t: 'line', level: 'error' }])
    expect(append).not.toHaveBeenCalled()
  })

  it('stops a run when asked, and removes its frame', async () => {
    const hook = mountHook(useRunner, 'javascript')
    const started = frameSays('started')
    void hook.current.run(NEVER_ENDS)
    const frame = onlyFrame()
    await started
    await vi.waitFor(() => expect(hook.current).toMatchObject({ status: 'running', busy: true }))

    hook.current.stop()

    expect(frame.isConnected).toBe(false)
    await vi.waitFor(() => expect(hook.current.status).toBe('stopped'), RUN_WAIT)
    expect(hook.current.busy).toBe(false)
  })

  it('stops a run that is still going when another starts, and shows only the new one', async () => {
    const hook = mountHook(useRunner, 'javascript')
    void hook.current.run(`console.log("first")\n${NEVER_ENDS}`)
    const first = onlyFrame()

    void hook.current.run('console.log("second")')

    expect(first.isConnected).toBe(false)
    await vi.waitFor(() => expect(hook.current.status).toBe('done'), RUN_WAIT)
    expect(hook.current.output.shown).toEqual([{ t: 'line', level: 'log', text: 'second', indent: 0 }])
  })

  it('ignores a message that looks like its run’s but comes from another window', async () => {
    const id = '00000000-0000-4000-8000-000000000001'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(id)
    const hook = mountHook(useRunner, 'javascript')
    void hook.current.run(NEVER_ENDS)
    const frame = onlyFrame()
    await vi.waitFor(() => expect(hook.current.status).toBe('running'), RUN_WAIT)

    const marker = Promise.withResolvers<void>()
    const listen = (event: MessageEvent) => {
      if (event.data === 'after the forged message') marker.resolve()
    }
    window.addEventListener('message', listen)
    onTestFinished(() => window.removeEventListener('message', listen))
    window.postMessage({ kind: 'done', id, ms: 1 }, '*')
    window.postMessage('after the forged message', '*')
    await marker.promise

    expect(frame.isConnected).toBe(true)
    expect(hook.current.status).toBe('running')
    hook.current.stop()
  })

  it('stops a run whose output reaches its limit', async () => {
    const hook = mountHook(useRunner, 'javascript')

    void hook.current.run('for (let i = 0; i < 5000; i++) console.log(i)')

    await vi.waitFor(() => expect(hook.current.status).toBe('capped'), RUN_WAIT)
    expect(hook.current.output.capped).toBe(true)
    expect(frames()).toEqual([])
  })

  it('stops a run that is still going when its time is up', async () => {
    fakeTimers()
    const hook = mountHook(useRunner, 'javascript')
    const started = frameSays('started')
    void hook.current.run(NEVER_ENDS)
    const frame = onlyFrame()
    await started

    vi.advanceTimersByTime(RUN_TIME_LIMIT.javascript - 1)
    expect(frame.isConnected).toBe(true)
    vi.advanceTimersByTime(1)

    expect(frame.isConnected).toBe(false)
    await vi.waitFor(() => expect(hook.current.status).toBe('timeout'), RUN_WAIT)
  })

  it('says the engine could not be readied when it fails to load', async () => {
    const hook = mountHook(useRunner, 'python')

    void hook.current.run('print(1)')

    await vi.waitFor(() => expect(hook.current.status).toBe('engine_failed'), RUN_WAIT)
    expect(hook.current.busy).toBe(false)
    expect(frames()).toEqual([])
  })

  it('removes its frame, clears its timer and stops listening when it unmounts mid-run', async () => {
    fakeTimers()
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const hook = mountHook(useRunner, 'javascript')
    const started = frameSays('started')
    void hook.current.run(NEVER_ENDS)
    const frame = onlyFrame()
    await started
    expect(vi.getTimerCount()).toBe(1)

    hook.unmount()

    expect(frame.isConnected).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(removeListener).toHaveBeenCalledWith('message', expect.any(Function))
  })
})
