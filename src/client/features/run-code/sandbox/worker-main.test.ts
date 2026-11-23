import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { inspect } from './inspect'
import type { FrameMessage, OutputEntry } from './protocol'
import { type WorkerEvent, type WorkerScope, workerMain } from './worker-main'

const PYODIDE = fileURLToPath(new URL('../../../../../node_modules/pyodide/', import.meta.url))

class TextBlob {
  readonly text: string
  constructor(parts: string[]) {
    this.text = parts.join('')
  }
}

const nodeLoad = (url: string): Promise<unknown> =>
  url.endsWith('sqlite3.mjs') ? import('@sqlite.org/sqlite-wasm') : import(/* @vite-ignore */ url)

function fakeWorker(load: (url: string) => Promise<unknown> = nodeLoad) {
  const messages: FrameMessage[] = []
  const listeners = new Map<string, (event: WorkerEvent) => void>()
  const waiting = new Map<string, () => void>()
  const revoked: string[] = []
  const context = createContext({
    postMessage: (message: FrameMessage) => {
      messages.push(structuredClone(message))
      if ((message.kind === 'done' || message.kind === 'failed') && waiting.has(message.id)) waiting.get(message.id)?.()
    },
    addEventListener: (type: string, listener: (event: WorkerEvent) => void) => listeners.set(type, listener),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    performance,
    Blob: TextBlob,
    URL: {
      createObjectURL: (blob: TextBlob) => `data:text/javascript;base64,${Buffer.from(blob.text).toString('base64')}`,
      revokeObjectURL: (url: string) => revoked.push(url),
    },
  })
  const scope = runInContext('globalThis', context) as WorkerScope
  workerMain(inspect, scope, load)
  let n = 0
  const send = (data: unknown) => listeners.get('message')?.({ data, preventDefault: () => {} })
  const run = (code: string, lang = 'javascript', engineBase = '') => {
    const id = `r${++n}`
    const from = messages.length
    const finished = new Promise<void>((resolve) => waiting.set(id, resolve))
    send({ kind: 'run', id, lang, code, engineBase })
    return finished.then(() => messages.slice(from).filter((m) => 'id' in m && m.id === id))
  }
  return { messages, listeners, revoked, run, send, scope }
}

const entriesOf = (messages: FrameMessage[]): OutputEntry[] =>
  messages.flatMap((m) => (m.kind === 'output' ? m.entries : []))
const textOf = (messages: FrameMessage[]) =>
  entriesOf(messages).map((e) => (e.t === 'line' ? `${e.level}${' '.repeat(e.indent)}:${e.text}` : e.t))
const doneOf = (messages: FrameMessage[]) => messages.find((m) => m.kind === 'done')

describe('JavaScript', () => {
  it('captures each console method', async () => {
    const { run } = fakeWorker()
    const messages = await run(
      [
        'console.log("a", 1, { b: [2] })',
        'console.info("i"); console.debug("d"); console.dir({ x: 1 })',
        'console.warn("w"); console.error(new TypeError("e"))',
        'console.assert(1 === 1, "fine"); console.assert(false, "broken"); console.assert(0)',
        'console.trace(); console.trace("here")',
        'console.count(); console.count(); console.count("x"); console.countReset(); console.count()',
        'console.time("t"); console.timeLog("nope"); console.timeLog("t"); console.timeEnd("t"); console.timeEnd("t")',
        'console.log("%s is %d, %i, %f: %o %O %j %c%%", "n", 4.5, 4.5, "1.5", [1], {}, 1, "color: red", "rest")',
        'console.log("%d", 10n); console.log("%s", { a: 1 }); console.log("%s and %s", "only one")',
      ].join('\n'),
    )
    const text = textOf(messages)
    expect(text.slice(0, 19)).toEqual([
      'log:a 1 { b: [ 2 ] }',
      'info:i',
      'log:d',
      'log:{ x: 1 }',
      'warn:w',
      'error:TypeError: e',
      'error:Assertion failed: broken',
      'error:Assertion failed',
      'log:Trace',
      'log:Trace: here',
      'log:default: 1',
      'log:default: 2',
      'log:x: 1',
      'log:default: 1',
      "warn:Timer 'nope' does not exist",
      expect.stringMatching(/^log:t: [\d.]+ ms$/),
      expect.stringMatching(/^log:t: [\d.]+ ms$/),
      "warn:Timer 't' does not exist",
      'log:n is 4.5, 4, 1.5: [ 1 ] {} 1 % rest',
    ])
    expect(text.slice(19)).toEqual(['log:10n', 'log:{ a: 1 }', 'log:only one and %s'])
    expect(doneOf(messages)).toMatchObject({ kind: 'done', ms: expect.any(Number) })
    expect(messages[0]).toEqual({ kind: 'started', id: 'r1' })
  })

  it('indents groups, makes a table and clears', async () => {
    const { run } = fakeWorker()
    const messages = await run(
      [
        'console.group("outer"); console.log("in"); console.groupCollapsed(); console.log("deeper")',
        'console.groupEnd(); console.groupEnd(); console.groupEnd(); console.log("out")',
        'console.table([{ a: 1, b: "x" }, { a: 2, c: true }, 3])',
        'console.table({ r: { a: 1, b: 2 } }, ["b"])',
        'console.table(new Map([["k", "v"]])); console.table(new Set(["s"])); console.table(5)',
        'console.clear()',
      ].join('\n'),
    )
    const entries = entriesOf(messages)
    expect(entries.slice(0, 4)).toEqual([
      { t: 'line', level: 'log', text: 'outer', indent: 0 },
      { t: 'line', level: 'log', text: 'in', indent: 1 },
      { t: 'line', level: 'log', text: 'deeper', indent: 2 },
      { t: 'line', level: 'log', text: 'out', indent: 0 },
    ])
    expect(entries[4]).toEqual({
      t: 'table',
      columns: ['(index)', 'a', 'b', 'c', 'Values'],
      rows: [
        ['0', '1', 'x', '', ''],
        ['1', '2', '', 'true', ''],
        ['2', '', '', '', '3'],
      ],
    })
    expect(entries[5]).toEqual({ t: 'table', columns: ['(index)', 'b'], rows: [['r', '2']] })
    expect(entries[6]).toEqual({ t: 'table', columns: ['(index)', 'Key', 'Values'], rows: [['0', 'k', 'v']] })
    expect(entries[7]).toEqual({ t: 'table', columns: ['(index)', 'Values'], rows: [['0', 's']] })
    expect(entries.slice(8)).toEqual([{ t: 'line', level: 'log', text: '5', indent: 0 }, { t: 'clear' }])
  })

  it('answers alert, confirm and prompt with a note', async () => {
    const { run } = fakeWorker()
    const messages = await run(
      'alert("hi"); alert(); console.log(confirm("sure?"), prompt("name?"), confirm(), prompt())',
    )
    expect(textOf(messages)).toEqual([
      'info:alert: hi',
      'info:alert: ',
      'info:confirm: sure? (no answer here, so false)',
      'info:prompt: name? (no answer here, so null)',
      'info:confirm:  (no answer here, so false)',
      'info:prompt:  (no answer here, so null)',
      'log:false null false null',
    ])
  })

  it('gives an error’s line from example.js', async () => {
    const { run } = fakeWorker()
    const messages = await run('let ten = 10;\nten()\nconsole.log("never")')
    expect(textOf(messages)).toEqual(['error:TypeError: ten is not a function'])
    expect(doneOf(messages)?.kind === 'done' && doneOf(messages)).toMatchObject({
      error: { message: 'TypeError: ten is not a function', line: 2 },
    })
    const thrown = await run('throw "a string"')
    expect(doneOf(thrown)).toMatchObject({ error: { message: 'Uncaught a string' } })
    expect(doneOf(thrown)?.kind === 'done' && doneOf(thrown)?.error?.line).toBeUndefined()
  })

  it('runs code that only parses as a module as one, and shows the script’s error when neither parses', async () => {
    const loaded: string[] = []
    const { run, revoked } = fakeWorker((url) => {
      loaded.push(url)
      return nodeLoad(url)
    })
    const module = await run('export const x = 1\nthrow new Error("from the module")')
    expect(doneOf(module)).toMatchObject({ error: { message: 'Error: from the module' } })
    expect(loaded).toHaveLength(1)
    expect(revoked).toEqual(loaded)
    const awaited = await run('await null\nexport {}')
    expect(doneOf(awaited)).toEqual({ kind: 'done', id: 'r2', ms: expect.any(Number) })
    const neither = await run('let = = 1')
    expect(doneOf(neither)).toMatchObject({ error: { message: expect.stringMatching(/^SyntaxError: /) } })
    expect(loaded).toHaveLength(3)
    const runtime = await run('JSON.parse("{")')
    expect(doneOf(runtime)).toMatchObject({ error: { message: expect.stringMatching(/^SyntaxError: /), line: 1 } })
    expect(loaded).toHaveLength(3)
  })

  it('keeps the run open while a timer is pending, and ends it when the last one is cleared', async () => {
    const { run } = fakeWorker()
    const later = await run('setTimeout((word) => console.log(word), 20, "later"); console.log("now")')
    expect(textOf(later)).toEqual(['log:now', 'log:later'])
    const ticks = await run(
      'let n = 0\nconst t = setInterval(() => { console.log(++n); if (n === 3) clearInterval(t) }, 5)',
    )
    expect(textOf(ticks)).toEqual(['log:1', 'log:2', 'log:3'])
    const cleared = await run('const t = setTimeout(() => console.log("no"), 50); clearTimeout(t)')
    expect(textOf(cleared)).toEqual([])
    const string = await run('setTimeout("console.log(\'from a string\')", 1)')
    expect(textOf(string)).toEqual(['log:from a string'])
  })

  it('waits for the promise the code ends on, and ends on an error thrown later', async () => {
    const { run } = fakeWorker()
    const main = await run(
      'async function main() { await new Promise((r) => setTimeout(r, 5)); console.log("done") }\nmain()',
    )
    expect(textOf(main)).toEqual(['log:done'])
    const rejected = await run('Promise.reject(new RangeError("no"))')
    expect(doneOf(rejected)).toMatchObject({ error: { message: 'RangeError: no' } })
    const timer = await run('setTimeout(() => { throw new Error("in a timer") }, 1)')
    expect(doneOf(timer)).toMatchObject({ error: { message: 'Error: in a timer', line: 1 } })
  })

  it('ends a run on an unhandled rejection or uncaught error, and ignores them between runs', async () => {
    const { run, listeners, messages } = fakeWorker()
    const pending = run('setTimeout(() => {}, 10_000)')
    listeners.get('unhandledrejection')?.({ reason: new Error('late'), preventDefault: () => {} })
    expect(doneOf(await pending)).toMatchObject({ error: { message: 'Error: late' } })
    const again = run('setTimeout(() => {}, 10_000)')
    listeners.get('error')?.({ message: 'Script error.', preventDefault: () => {} })
    expect(doneOf(await again)).toMatchObject({ error: { message: 'Uncaught Script error.' } })
    const before = messages.length
    listeners.get('error')?.({ error: new Error('after'), preventDefault: () => {} })
    listeners.get('unhandledrejection')?.({ reason: 1, preventDefault: () => {} })
    expect(messages.length).toBe(before)
  })

  it('takes one run at a time and ignores anything that isn’t a run', async () => {
    const { run, send, messages } = fakeWorker()
    const first = run('setTimeout(() => console.log("first"), 10)')
    send({ kind: 'run', id: 'other', lang: 'javascript', code: 'console.log("second")', engineBase: '' })
    send(null)
    send({ kind: 'stop' })
    send({ kind: 'run', id: 5, code: '' })
    expect(textOf(await first)).toEqual(['log:first'])
    expect(messages.some((m) => 'id' in m && m.id === 'other')).toBe(false)
  })

  it('sends a flood of output in batches, so the page can stop it', async () => {
    const { run } = fakeWorker()
    const messages = await run('for (let i = 0; i < 250; i++) console.log(i)')
    const batches = messages.filter((m) => m.kind === 'output')
    expect(batches.map((m) => m.kind === 'output' && m.entries.length)).toEqual([100, 100, 50])
    const long = await run(
      'console.log("x".repeat(10_001)); for (let i = 0; i < 6; i++) console.log("y".repeat(10_000))',
    )
    const first = entriesOf(long)[0]
    expect(first?.t === 'line' && first.text).toBe(`${'x'.repeat(10_000)}…`)
    expect(long.filter((m) => m.kind === 'output').length).toBeGreaterThan(1)
  })
})

describe('Python', () => {
  it('loads once, then runs each example in fresh globals', { timeout: 30_000 }, async () => {
    const { run } = fakeWorker()
    const first = await run('import sys\nprint(sum(range(5)))\nkept = 1\nprint("partial", end="")', 'python', PYODIDE)
    expect(first.slice(0, 2)).toEqual([
      { kind: 'loading', id: 'r1', engine: 'python' },
      { kind: 'started', id: 'r1' },
    ])
    expect(textOf(first)).toEqual(['log:10', 'log:partial'])
    expect(doneOf(first)).toEqual({ kind: 'done', id: 'r1', ms: expect.any(Number) })
    const second = await run('import sys\nprint("kept" in globals(), file=sys.stderr)', 'python', PYODIDE)
    expect(second[0]).toEqual({ kind: 'started', id: 'r2' })
    expect(textOf(second)).toEqual(['error:False'])
  })

  it('sends a line that never ends once it is longer than a line may be', { timeout: 30_000 }, async () => {
    const { run } = fakeWorker()
    const messages = await run(
      'import sys\nsys.stdout.write("x" * 10_001)\nsys.stdout.flush()\nprint("y", end="")',
      'python',
      PYODIDE,
    )
    expect(textOf(messages)).toEqual([`log:${'x'.repeat(10_000)}…`, 'log:y'])
  })

  it('shows a traceback without Pyodide’s frames, the exception first, with its line', {
    timeout: 30_000,
  }, async () => {
    const { run } = fakeWorker()
    const missing = await run('x = 1\nimport numpy', 'python', PYODIDE)
    expect(textOf(missing)).toEqual([
      "error:ModuleNotFoundError: No module named 'numpy'",
      'error:Traceback (most recent call last):',
      'error:  File "<exec>", line 2, in <module>',
    ])
    expect(doneOf(missing)).toMatchObject({
      error: { message: "ModuleNotFoundError: No module named 'numpy'", line: 2 },
    })
    const syntax = await run('print(', 'python', PYODIDE)
    expect(textOf(syntax)[0]).toBe("error:SyntaxError: '(' was never closed")
    expect(doneOf(syntax)).toMatchObject({ error: { line: 1 } })
    const asked = await run('name = input("Name? ")', 'python', PYODIDE)
    expect(doneOf(asked)).toMatchObject({ error: { message: "RuntimeError: input() isn't available here", line: 1 } })
  })

  it('says the engine failed when it can’t be loaded', async () => {
    const { run } = fakeWorker(() => Promise.reject(new Error('offline')))
    expect(await run('print(1)', 'python', '/nowhere/')).toEqual([
      { kind: 'loading', id: 'r1', engine: 'python' },
      { kind: 'failed', id: 'r1', reason: 'engine' },
    ])
  })
})

describe('SQL', () => {
  it('runs statement by statement: tables for rows, a count for changes', async () => {
    const { run } = fakeWorker()
    const messages = await run(
      [
        '-- books',
        'create table books (title text, pages integer, cover blob, note);',
        "insert into books values ('Emma', 474, x'0a1b', null), ('Persuasion', 249, null, 1.5);",
        'select title, pages, cover, note from books order by pages;',
        "update books set note = 'x' where pages > 300;",
        'select * from books where 0; -- the end',
      ].join('\n'),
      'sql',
      '/run-code/sqlite/',
    )
    expect(messages[0]).toEqual({ kind: 'loading', id: 'r1', engine: 'sqlite' })
    expect(entriesOf(messages)).toEqual([
      { t: 'line', level: 'info', text: '2 rows changed', indent: 0 },
      {
        t: 'table',
        columns: ['title', 'pages', 'cover', 'note'],
        rows: [
          ['Persuasion', '249', 'NULL', '1.5'],
          ['Emma', '474', "x'0a1b'", 'NULL'],
        ],
      },
      { t: 'line', level: 'info', text: '1 row changed', indent: 0 },
      { t: 'table', columns: ['title', 'pages', 'cover', 'note'], rows: [] },
    ])
    expect(doneOf(messages)).toEqual({ kind: 'done', id: 'r1', ms: expect.any(Number) })
  })

  it('starts each run with an empty database, and names the statement an error is in', async () => {
    const { run } = fakeWorker()
    await run('create table t (a);', 'sql', '/')
    const messages = await run('select 1;\n\nselect * from t;', 'sql', '/')
    expect(messages[0]).toEqual({ kind: 'started', id: 'r2' })
    expect(textOf(messages).at(-1)).toBe('error:Error in statement 2: no such table: t')
    expect(doneOf(messages)).toMatchObject({ error: { message: 'Error in statement 2: no such table: t', line: 3 } })
    const stepping = await run('select 1;\nselect abs(-9223372036854775807 - 1);', 'sql', '/')
    expect(doneOf(stepping)).toMatchObject({ error: { message: 'Error in statement 2: integer overflow', line: 2 } })
  })

  it('writes a long blob cut at 32 bytes, and stops reading rows at 1,000', async () => {
    const { run } = fakeWorker()
    const messages = await run(
      'select randomblob(40) as b; with recursive n(i) as (select 1 union all select i + 1 from n) select i from n;',
      'sql',
      '/',
    )
    const [blob, many] = entriesOf(messages)
    expect(blob?.t === 'table' && blob.rows[0]?.[0]).toMatch(/^x'[0-9a-f]{64}…'$/)
    expect(many?.t === 'table' && many.rows.length).toBe(1000)
  })

  it('says the engine failed when it can’t be loaded', async () => {
    const { run } = fakeWorker(() => Promise.reject(new Error('offline')))
    expect(await run('select 1', 'sql', '/')).toEqual([
      { kind: 'loading', id: 'r1', engine: 'sqlite' },
      { kind: 'failed', id: 'r1', reason: 'engine' },
    ])
  })
})
