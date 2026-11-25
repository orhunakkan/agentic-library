import type { OutputEntry, RunError } from './protocol'

export interface WorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: string, listener: (event: WorkerEvent) => void): void
  setTimeout(handler: unknown, ms?: number, ...args: unknown[]): unknown
  clearTimeout(handle: unknown): void
  setInterval(handler: unknown, ms?: number, ...args: unknown[]): unknown
  clearInterval(handle: unknown): void
  eval(code: string): unknown
  Function: FunctionConstructor
  Blob: typeof Blob
  URL: { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void }
  performance: { now(): number }
  console: unknown
  alert: unknown
  confirm: unknown
  prompt: unknown
}

export interface WorkerEvent {
  data?: unknown
  reason?: unknown
  error?: unknown
  message?: string
  preventDefault(): void
}

interface Python {
  runPython(code: string, options?: { filename: string }): unknown
  runPythonAsync(code: string, options: { globals: unknown; filename: string }): Promise<unknown>
  setStdout(options: { write: (buffer: Uint8Array) => number }): void
  setStderr(options: { write: (buffer: Uint8Array) => number }): void
  globals: { get(name: string): () => { destroy?: () => void } }
}

interface Sqlite {
  oo1: { DB: new (name: string, flags: string) => SqliteDb }
  capi: { sqlite3_sql(pointer: unknown): string | null }
}
interface SqliteDb {
  prepare(sql: string): SqliteStmt
  changes(total: boolean): number
  close(): void
}
interface SqliteStmt {
  pointer: unknown
  columnCount: number
  getColumnNames(): string[]
  step(): boolean
  get(index: number): unknown
  finalize(): void
}

interface Run {
  id: string
  indent: number
  batch: OutputEntry[]
  batchChars: number
  timers: Set<unknown>
  counts: Map<string, number>
  times: Map<string, number>
  started: number
  topDone: boolean
  ended: boolean
}

export function workerMain(
  inspect: (value: unknown) => string,
  scope: WorkerScope,
  load: (url: string) => Promise<unknown>,
): void {
  const MAX_LINE = 10_000
  const BATCH_ENTRIES = 100
  const BATCH_CHARS = 50_000
  const MAX_ROWS = 1_000
  const MAX_COLUMNS = 100
  const BLOB_BYTES = 32
  const SOURCE = 'example.js'
  const realSetTimeout = scope.setTimeout.bind(scope)
  const realClearTimeout = scope.clearTimeout.bind(scope)
  const realSetInterval = scope.setInterval.bind(scope)
  const realClearInterval = scope.clearInterval.bind(scope)
  const now = () => scope.performance.now()
  const post = (message: unknown) => scope.postMessage(message)

  let run: Run | null = null
  let python: Python | null = null
  let sqlite: Sqlite | null = null
  let shimmed = false

  const cutText = (text: string) => (text.length <= MAX_LINE ? text : `${text.slice(0, MAX_LINE)}…`)

  const flush = (owner: Run) => {
    if (!owner.batch.length) return
    post({ kind: 'output', id: owner.id, entries: owner.batch })
    owner.batch = []
    owner.batchChars = 0
  }

  const emit = (entry: OutputEntry, chars: number) => {
    const owner = run
    if (!owner || owner.ended) return
    owner.batch.push(entry)
    owner.batchChars += chars
    if (owner.batch.length >= BATCH_ENTRIES || owner.batchChars >= BATCH_CHARS) flush(owner)
    else if (owner.batch.length === 1) realSetTimeout(() => flush(owner), 0)
  }

  const line = (level: 'log' | 'info' | 'warn' | 'error', text: string) => {
    const cut = cutText(text)
    emit({ t: 'line', level, text: cut, indent: run?.indent ?? 0 }, cut.length)
  }

  const finish = (owner: Run, error?: RunError) => {
    if (owner.ended) return
    flush(owner)
    owner.ended = true
    const ms = Math.max(0, now() - owner.started)
    post(error ? { kind: 'done', id: owner.id, ms, error } : { kind: 'done', id: owner.id, ms })
  }

  const begin = (owner: Run) => {
    post({ kind: 'started', id: owner.id })
    owner.started = now()
  }

  const engineFailed = (owner: Run) => {
    owner.ended = true
    post({ kind: 'failed', id: owner.id, reason: 'engine' })
  }

  const isError = (value: unknown): value is { name?: unknown; message?: unknown; stack?: unknown } =>
    typeof value === 'object' && value !== null && 'message' in value

  const messageOf = (error: unknown) => (isError(error) ? String(error.message) : String(error))

  const lineOf = (error: unknown, moduleUrl: string | null): number | undefined => {
    if (!isError(error)) return undefined
    const stack = typeof error.stack === 'string' ? error.stack : ''
    const patterns = [/example\.js:(\d+):\d+/, / > eval:(\d+):\d+/]
    if (moduleUrl) patterns.unshift(new RegExp(`${moduleUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):\\d+`))
    for (const pattern of patterns) {
      const found = pattern.exec(stack)
      if (found) return Number(found[1])
    }
    const lineNumber = (error as { lineNumber?: unknown }).lineNumber
    return error.name === 'SyntaxError' && typeof lineNumber === 'number' && lineNumber > 0 ? lineNumber : undefined
  }

  const errorOf = (error: unknown, moduleUrl: string | null = null): RunError => {
    const message = isError(error) ? inspect(error) : `Uncaught ${inspect(error)}`
    const at = lineOf(error, moduleUrl)
    return at ? { message: cutText(message), line: at } : { message: cutText(message) }
  }

  const fail = (owner: Run, error: unknown, moduleUrl: string | null = null) => {
    if (owner.ended) return
    const info = errorOf(error, moduleUrl)
    if (run === owner) line('error', info.message)
    finish(owner, info)
  }

  const settle = (owner: Run | null) => {
    if (!owner || owner.ended || !owner.topDone || owner.timers.size) return
    realSetTimeout(() => {
      if (!owner.ended && owner.topDone && owner.timers.size === 0) finish(owner)
    }, 0)
  }

  const call = (owner: Run | null, handler: unknown, args: unknown[]) => {
    try {
      if (typeof handler === 'function') handler(...args)
      else scope.eval(String(handler))
    } catch (error) {
      if (owner) fail(owner, error)
    }
  }

  const formatArgs = (args: unknown[]): string => {
    const first = args[0]
    if (typeof first !== 'string' || !first.includes('%')) return args.map((a) => inspect(a)).join(' ')
    let next = 1
    const head = first.replace(/%([sdifoOjc%])/g, (match, flag: string) => {
      if (flag === '%') return '%'
      if (next >= args.length) return match
      const arg = args[next++]
      if (flag === 's') return typeof arg === 'string' ? arg : inspect(arg)
      if (flag === 'd' || flag === 'i') {
        if (typeof arg === 'bigint') return `${arg}n`
        const n = Number(arg)
        return String(flag === 'i' ? Math.trunc(n) : n)
      }
      if (flag === 'f') return String(Number(arg))
      if (flag === 'c') return ''
      return inspect(arg)
    })
    return [head, ...args.slice(next).map((a) => inspect(a))].join(' ')
  }

  const table = (data: unknown, only?: unknown) => {
    if (typeof data !== 'object' || data === null) {
      line('log', formatArgs([data]))
      return
    }
    const entries = (method: () => Iterable<unknown>) => {
      try {
        return [...method()]
      } catch {
        return null
      }
    }
    const mapped = entries(() => Map.prototype.entries.call(data)) as [unknown, unknown][] | null
    const setted = mapped ? null : entries(() => Set.prototype.values.call(data))
    const pairs: [string, unknown][] = mapped
      ? mapped.map(([k, v], i) => [String(i), { Key: k, Values: v }])
      : setted
        ? setted.map((v, i) => [String(i), v])
        : Object.entries(data)
    const keys: string[] = []
    let values = false
    for (const [, value] of pairs.slice(0, MAX_ROWS)) {
      if (typeof value === 'object' && value !== null) {
        for (const key of Object.keys(value)) if (!keys.includes(key)) keys.push(key)
      } else values = true
    }
    const wanted = Array.isArray(only) ? keys.filter((k) => only.map(String).includes(k)) : keys
    const columns = ['(index)', ...wanted, ...(values ? ['Values'] : [])].slice(0, MAX_COLUMNS)
    const cell = (value: unknown) => cutText(typeof value === 'string' ? value : inspect(value))
    const rows = pairs.slice(0, MAX_ROWS).map(([index, value]) =>
      columns.map((column) => {
        if (column === '(index)') return index
        const object = typeof value === 'object' && value !== null
        if (column === 'Values' && !wanted.includes('Values')) return object ? '' : cell(value)
        return object && Object.hasOwn(value, column) ? cell((value as Record<string, unknown>)[column]) : ''
      }),
    )
    emit({ t: 'table', columns, rows }, rows.length * columns.length)
  }

  const shim = () => {
    if (shimmed) return
    shimmed = true
    const ms = (n: number) => `${Number(n.toFixed(3))} ms`
    const label = (value: unknown) => (value === undefined ? 'default' : String(value))
    const log = (...args: unknown[]) => line('log', formatArgs(args))
    const elapsed = (name: unknown): boolean => {
      const start = run?.times.get(label(name))
      if (start === undefined) {
        line('warn', `Timer '${label(name)}' does not exist`)
        return false
      }
      line('log', `${label(name)}: ${ms(now() - start)}`)
      return true
    }
    const asked = (message: unknown) => (message === undefined ? '' : formatArgs([message]))
    const group = (...args: unknown[]) => {
      if (args.length) log(...args)
      if (run) run.indent = Math.min(run.indent + 1, 20)
    }
    scope.console = {
      log,
      debug: log,
      info: (...args: unknown[]) => line('info', formatArgs(args)),
      warn: (...args: unknown[]) => line('warn', formatArgs(args)),
      error: (...args: unknown[]) => line('error', formatArgs(args)),
      trace: (...args: unknown[]) => line('log', args.length ? `Trace: ${formatArgs(args)}` : 'Trace'),
      dir: (value: unknown) => line('log', inspect(value)),
      assert: (condition: unknown, ...args: unknown[]) => {
        if (!condition) line('error', args.length ? `Assertion failed: ${formatArgs(args)}` : 'Assertion failed')
      },
      table,
      clear: () => emit({ t: 'clear' }, 0),
      group,
      groupCollapsed: group,
      groupEnd: () => {
        if (run) run.indent = Math.max(0, run.indent - 1)
      },
      time: (name?: unknown) => run?.times.set(label(name), now()),
      timeLog: (name?: unknown) => {
        elapsed(name)
      },
      timeEnd: (name?: unknown) => {
        if (elapsed(name)) run?.times.delete(label(name))
      },
      count: (name?: unknown) => {
        const n = (run?.counts.get(label(name)) ?? 0) + 1
        run?.counts.set(label(name), n)
        line('log', `${label(name)}: ${n}`)
      },
      countReset: (name?: unknown) => run?.counts.set(label(name), 0),
    }
    scope.alert = (message?: unknown) => line('info', `alert: ${asked(message)}`)
    scope.confirm = (message?: unknown) => {
      line('info', `confirm: ${asked(message)} (no answer here, so false)`)
      return false
    }
    scope.prompt = (message?: unknown) => {
      line('info', `prompt: ${asked(message)} (no answer here, so null)`)
      return null
    }
    scope.setTimeout = (handler: unknown, delay?: number, ...args: unknown[]) => {
      const owner = run
      const handle = realSetTimeout(() => {
        owner?.timers.delete(handle)
        call(owner, handler, args)
        settle(owner)
      }, delay)
      owner?.timers.add(handle)
      return handle
    }
    scope.clearTimeout = (handle: unknown) => {
      realClearTimeout(handle)
      if (run?.timers.delete(handle)) settle(run)
    }
    scope.setInterval = (handler: unknown, delay?: number, ...args: unknown[]) => {
      const owner = run
      const handle = realSetInterval(() => call(owner, handler, args), delay)
      owner?.timers.add(handle)
      return handle
    }
    scope.clearInterval = (handle: unknown) => {
      realClearInterval(handle)
      if (run?.timers.delete(handle)) settle(run)
    }
  }

  const unparsable = (error: unknown, code: string) => {
    if (!isError(error) || error.name !== 'SyntaxError') return false
    try {
      new scope.Function(code)
      return false
    } catch (again) {
      return isError(again) && again.name === 'SyntaxError'
    }
  }

  const runJavaScript = async (owner: Run, code: string) => {
    shim()
    begin(owner)
    const source = `${code}\n//# sourceURL=${SOURCE}`
    let value: unknown
    try {
      value = scope.eval(source)
    } catch (error) {
      if (!unparsable(error, code)) return fail(owner, error)
      const url = scope.URL.createObjectURL(new scope.Blob([source], { type: 'text/javascript' }))
      try {
        await load(url)
      } catch (moduleError) {
        return isError(moduleError) && moduleError.name === 'SyntaxError'
          ? fail(owner, error)
          : fail(owner, moduleError, url)
      } finally {
        scope.URL.revokeObjectURL(url)
      }
    }
    if (typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function') {
      try {
        await value
      } catch (error) {
        return fail(owner, error)
      }
    }
    owner.topDone = true
    settle(owner)
  }

  const PRELUDE = [
    'import builtins',
    'def _folio_no_input(prompt=""):',
    '    raise RuntimeError("input() isn\'t available here")',
    'builtins.input = _folio_no_input',
    'del _folio_no_input',
  ].join('\n')

  const traceback = (text: string): { lines: string[]; last: string; at?: number } => {
    const lines = text.replace(/\n+$/, '').split('\n')
    const kept: string[] = []
    let skipping = false
    let at: number | undefined
    for (const entry of lines) {
      const frame = /^ {2}File "([^"]*)", line (\d+)/.exec(entry)
      if (frame) {
        skipping = frame[1] !== '<exec>'
        if (!skipping) at = Number(frame[2])
      } else if (!entry.startsWith('  ')) skipping = false
      if (!skipping) kept.push(entry)
    }
    const first = kept.findIndex((l) => !l.startsWith(' ') && l !== 'Traceback (most recent call last):')
    let tail = first === -1 ? [] : kept.slice(first)
    if (tail[0]?.startsWith('ModuleNotFoundError')) tail = tail.slice(0, 1)
    const last = tail.join('\n') || text.trim()
    const head = first === -1 ? kept : kept.slice(0, first)
    return { lines: head.length > 1 ? head : [], last, at }
  }

  const pending = { log: '', error: '' }
  let decoders: Record<'log' | 'error', TextDecoder> | null = null
  const writer = (level: 'log' | 'error') => (buffer: Uint8Array) => {
    decoders ??= { log: new TextDecoder(), error: new TextDecoder() }
    const parts = (pending[level] + decoders[level].decode(buffer, { stream: true })).split('\n')
    pending[level] = parts.pop() ?? ''
    for (const part of parts) line(level, part)
    if (pending[level].length > MAX_LINE) {
      line(level, pending[level])
      pending[level] = ''
    }
    return buffer.length
  }
  const flushStreams = (engine: Python) => {
    engine.runPython('import sys\nsys.stdout.flush()\nsys.stderr.flush()', { filename: '<folio>' })
    for (const level of ['log', 'error'] as const) {
      if (pending[level]) line(level, pending[level])
      pending[level] = ''
    }
  }

  const runPython = async (owner: Run, code: string, base: string) => {
    if (!python) {
      post({ kind: 'loading', id: owner.id, engine: 'python' })
      try {
        const module = (await load(`${base}pyodide.mjs`)) as {
          loadPyodide(options: { indexURL: string; packages: string[] }): Promise<Python>
        }
        const engine = await module.loadPyodide({ indexURL: base, packages: [] })
        engine.runPython(PRELUDE, { filename: '<folio>' })
        engine.setStdout({ write: writer('log') })
        engine.setStderr({ write: writer('error') })
        python = engine
      } catch {
        return engineFailed(owner)
      }
    }
    const engine = python
    begin(owner)
    const globals = engine.globals.get('dict')()
    try {
      await engine.runPythonAsync(code, { globals, filename: '<exec>' })
      flushStreams(engine)
      finish(owner)
    } catch (error) {
      flushStreams(engine)
      const text = messageOf(error)
      const { lines, last, at } = traceback(text)
      line('error', last)
      for (const entry of lines) line('error', entry)
      finish(owner, at ? { message: cutText(last), line: at } : { message: cutText(last) })
    } finally {
      globals.destroy?.()
    }
  }

  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return 'NULL'
    if (Object.prototype.toString.call(value) === '[object Uint8Array]') {
      const bytes = value as Uint8Array
      const hex = [...bytes.subarray(0, BLOB_BYTES)].map((b) => b.toString(16).padStart(2, '0')).join('')
      return `x'${hex}${bytes.length > BLOB_BYTES ? '…' : ''}'`
    }
    return cutText(String(value))
  }

  const lineAt = (code: string, offset: number) => code.slice(0, offset).split('\n').length

  const runSql = async (owner: Run, code: string, base: string) => {
    if (!sqlite) {
      post({ kind: 'loading', id: owner.id, engine: 'sqlite' })
      try {
        const module = (await load(`${base}sqlite3.mjs`)) as {
          default(options: { print: () => void; printErr: () => void }): Promise<Sqlite>
        }
        sqlite = await module.default({ print: () => {}, printErr: () => {} })
      } catch {
        return engineFailed(owner)
      }
    }
    const engine = sqlite
    begin(owner)
    const db = new engine.oo1.DB(':memory:', 'c')
    let rest = code
    let consumed = 0
    let statementCount = 0
    try {
      while (/\S/.test(rest)) {
        const start = consumed + (rest.length - rest.trimStart().length)
        let stmt: SqliteStmt
        try {
          stmt = db.prepare(rest)
        } catch (error) {
          if (isError(error) && /empty SQL/i.test(String(error.message))) break
          throw { error, statement: statementCount + 1, start }
        }
        statementCount++
        const text = engine.capi.sqlite3_sql(stmt.pointer) ?? rest
        try {
          const before = db.changes(true)
          const columns = stmt.columnCount ? stmt.getColumnNames().slice(0, MAX_COLUMNS) : []
          const rows: string[][] = []
          while (rows.length < MAX_ROWS && stmt.step()) rows.push(columns.map((_, i) => cell(stmt.get(i))))
          if (columns.length) emit({ t: 'table', columns, rows }, rows.length * columns.length)
          else {
            const changed = db.changes(true) - before
            if (changed) line('info', `${changed} ${changed === 1 ? 'row' : 'rows'} changed`)
          }
        } catch (error) {
          throw { error, statement: statementCount, start }
        } finally {
          stmt.finalize()
        }
        consumed += text.length
        rest = rest.slice(text.length)
      }
      finish(owner)
    } catch (thrown) {
      const { error, statement, start } = thrown as { error: unknown; statement: number; start: number }
      const reason = messageOf(error).replace(/^SQLITE_\w+: sqlite3 result code \d+: /, '')
      const message = cutText(`Error in statement ${statement}: ${reason}`)
      line('error', message)
      finish(owner, { message, line: lineAt(code, start) })
    } finally {
      db.close()
    }
  }

  scope.addEventListener('message', (event) => {
    const request = event.data as { kind?: unknown; id?: unknown; lang?: unknown; code?: unknown; engineBase?: unknown }
    if (request?.kind !== 'run' || typeof request.id !== 'string' || typeof request.code !== 'string') return
    if (run && !run.ended) return
    const owner: Run = {
      id: request.id,
      indent: 0,
      batch: [],
      batchChars: 0,
      timers: new Set(),
      counts: new Map(),
      times: new Map(),
      started: now(),
      topDone: false,
      ended: false,
    }
    run = owner
    const base = typeof request.engineBase === 'string' ? request.engineBase : ''
    if (request.lang === 'python') void runPython(owner, request.code, base)
    else if (request.lang === 'sql') void runSql(owner, request.code, base)
    else void runJavaScript(owner, request.code)
  })

  scope.addEventListener('unhandledrejection', (event) => {
    event.preventDefault()
    if (run && !run.ended) fail(run, event.reason)
  })

  scope.addEventListener('error', (event) => {
    event.preventDefault()
    if (run && !run.ended) fail(run, event.error ?? event.message)
  })
}
