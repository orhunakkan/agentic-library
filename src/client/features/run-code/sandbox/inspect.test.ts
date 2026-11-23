import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { inspect } from './inspect'

describe('inspect', () => {
  it('writes strings bare at the top and quoted inside', () => {
    expect(inspect('hi')).toBe('hi')
    expect(inspect(['a', "it's", 'say "x"\n'])).toBe(`[ 'a', "it's", 'say "x"\\n' ]`)
    expect(inspect({ 'a-b': 'c', ok: 1 })).toBe("{ 'a-b': 'c', ok: 1 }")
  })

  it('writes the primitives as Node does', () => {
    expect([-0, 0, 1.5, Number.NaN, 10n, true, null, undefined].map(inspect)).toEqual([
      '-0',
      '0',
      '1.5',
      'NaN',
      '10n',
      'true',
      'null',
      'undefined',
    ])
    expect(inspect(Symbol('s'))).toBe('Symbol(s)')
    expect(inspect({ [Symbol('k')]: 1 })).toBe('{ [Symbol(k)]: 1 }')
  })

  it('shows holes, and cuts arrays at 100 items', () => {
    // biome-ignore lint/suspicious/noSparseArray: the holes are what is tested.
    expect(inspect([1, , , 4])).toBe('[ 1, <2 empty items>, 4 ]')
    // biome-ignore lint/suspicious/noSparseArray: the holes are what is tested.
    expect(inspect([, 1])).toBe('[ <1 empty item>, 1 ]')
    const long = inspect(Array.from({ length: 101 }, () => 0))
    expect(long.endsWith('… 1 more item\n]')).toBe(true)
    expect(inspect(Array.from({ length: 102 }, () => 0))).toContain('… 2 more items')
    expect(inspect([])).toBe('[]')
    expect(inspect({})).toBe('{}')
  })

  it('goes three levels deep, then names the object', () => {
    expect(inspect({ a: { b: { c: { d: 1 } } } })).toBe('{ a: { b: { c: { d: 1 } } } }')
    expect(inspect({ a: { b: { c: { d: { e: 1 } } } } })).toBe('{ a: { b: { c: { d: [Object] } } } }')
    expect(inspect([[[[[1]]]]])).toBe('[ [ [ [ [Array] ] ] ] ]')
  })

  it('marks a value inside itself as circular', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(inspect(a)).toBe("{ name: 'a', self: [Circular] }")
  })

  it('writes Map, Set, Date, RegExp, errors and typed arrays', () => {
    expect(
      inspect(
        new Map<unknown, unknown>([
          ['a', 1],
          [2, { b: true }],
        ]),
      ),
    ).toBe("Map(2) { 'a' => 1, 2 => { b: true } }")
    expect(inspect(new Set([1, 'x']))).toBe("Set(2) { 1, 'x' }")
    expect(inspect(new Map())).toBe('Map(0) {}')
    expect(inspect(new Date(0))).toBe('1970-01-01T00:00:00.000Z')
    expect(inspect(new Date(Number.NaN))).toBe('Invalid Date')
    expect(inspect(/a+b/gi)).toBe('/a+b/gi')
    expect(inspect(new TypeError('boom'))).toBe('TypeError: boom')
    expect(inspect({ e: new Error('x') })).toBe('{ e: [Error: x] }')
    expect(inspect(new Error(''))).toBe('Error')
    expect(inspect(new Uint8Array([1, 2]))).toBe('Uint8Array(2) [ 1, 2 ]')
    expect(inspect(new ArrayBuffer(8))).toBe('ArrayBuffer { byteLength: 8 }')
    expect(inspect(new WeakMap())).toBe('WeakMap { <items unknown> }')
    expect(inspect(new WeakSet())).toBe('WeakSet { <items unknown> }')
    expect(inspect(Promise.resolve(1))).toBe('Promise { <unknown> }')
  })

  it('names classes, their instances and functions', () => {
    class Point {
      constructor(
        public x: number,
        public y = 2,
      ) {}
    }
    class Point3 extends Point {}
    expect(inspect(new Point(1))).toBe('Point { x: 1, y: 2 }')
    expect(inspect(Point)).toBe('[class Point]')
    expect(inspect(Point3)).toBe('[class Point3 extends Point]')
    function f() {}
    expect(inspect(f)).toBe('[Function: f]')
    expect(inspect([() => 1])).toBe('[ [Function (anonymous)] ]')
    expect(inspect(Object.assign(() => 1, { extra: true }))).toBe('[Function (anonymous)] { extra: true }')
    expect(inspect(Object.create(null))).toBe('[Object: null prototype] {}')
  })

  it('shows accessors without calling them, and survives a hostile object', () => {
    const o = {
      get a() {
        throw new Error('called')
      },
      set b(_: number) {},
      get c() {
        return 1
      },
      set c(_: number) {},
    }
    expect(inspect(o)).toBe('{ a: [Getter], b: [Setter], c: [Getter/Setter] }')
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('no')
        },
      },
    )
    expect(inspect(hostile)).toBe('{}')
    const nameless = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error('no')
        },
      },
    )
    expect(inspect(nameless)).toBe('{}')
    const broken = new Proxy({}, { getPrototypeOf: () => ({}), ownKeys: () => [1 as never] })
    expect(typeof inspect(broken)).toBe('string')
    const worst = new Proxy(() => {}, {
      get: () => {
        throw new Error('no')
      },
      getPrototypeOf: () => {
        throw new Error('no')
      },
    })
    expect(inspect(worst)).toBe('[object]')
  })

  it('breaks a long object over lines', () => {
    const text = inspect({ first: 'a'.repeat(30), second: 'b'.repeat(30), third: 3 })
    expect(text).toBe(`{\n  first: '${'a'.repeat(30)}',\n  second: '${'b'.repeat(30)}',\n  third: 3\n}`)
    expect(inspect({ inner: { first: 'a'.repeat(40), second: 'b'.repeat(40) } })).toContain('\n    first:')
  })

  it('reads values from another realm, as the worker’s code makes them', () => {
    const made = runInNewContext(
      '({ m: new Map([[1, 2]]), s: new Set([3]), d: new Date(0), r: /x/, e: new RangeError("far"), u: new Uint8Array(1) })',
    )
    expect(inspect(made)).toBe(
      '{\n  m: Map(1) { 1 => 2 },\n  s: Set(1) { 3 },\n  d: 1970-01-01T00:00:00.000Z,\n  r: /x/,\n  e: [RangeError: far],\n  u: Uint8Array(1) [ 0 ]\n}',
    )
  })

  it('runs on its own, with nothing from its module', () => {
    const own = runInNewContext(`(${String(inspect)})`)
    expect(own({ a: [1, 'b'], m: new Map() })).toBe("{ a: [ 1, 'b' ], m: Map(0) {} }")
  })
})
