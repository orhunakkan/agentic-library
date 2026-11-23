export function inspect(value: unknown): string {
  const MAX_DEPTH = 3
  const MAX_ITEMS = 100
  const WIDTH = 72

  const quote = (text: string): string => {
    const q = text.includes("'") && !text.includes('"') ? '"' : "'"
    const body = text
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(/\r/g, '\\r')
      .replaceAll(q, `\\${q}`)
    return q + body + q
  }

  const keyOf = (key: string | symbol): string => {
    if (typeof key === 'symbol') return `[${String(key)}]`
    return /^[A-Za-z_$][\w$]*$/.test(key) ? key : quote(key)
  }

  const nameOf = (object: object): string => {
    try {
      const proto = Object.getPrototypeOf(object)
      if (proto === null) return '[Object: null prototype]'
      const name = proto?.constructor?.name
      return typeof name === 'string' ? name : ''
    } catch {
      return ''
    }
  }

  const fnText = (fn: (...args: never[]) => unknown): string => {
    let source = ''
    try {
      source = Function.prototype.toString.call(fn)
    } catch {}
    const name = fn.name
    if (source.startsWith('class')) {
      const parent = Object.getPrototypeOf(fn)
      const extend = typeof parent === 'function' && parent.name ? ` extends ${parent.name}` : ''
      return `[class ${name || '(anonymous)'}${extend}]`
    }
    return name ? `[Function: ${name}]` : '[Function (anonymous)]'
  }

  const brand = (check: () => unknown): boolean => {
    try {
      check()
      return true
    } catch {
      return false
    }
  }
  const tag = (object: object) => Object.prototype.toString.call(object)
  const getter = (proto: object, key: string) =>
    Object.getOwnPropertyDescriptor(proto, key)?.get as (this: unknown) => unknown
  const kindOf = (object: object): string => {
    const isError = (Error as { isError?: (value: unknown) => boolean }).isError
    if (isError ? isError(object) : tag(object) === '[object Error]') return 'Error'
    if (brand(() => Date.prototype.getTime.call(object))) return 'Date'
    if (object !== RegExp.prototype && brand(() => getter(RegExp.prototype, 'source').call(object))) return 'RegExp'
    if (brand(() => Map.prototype.has.call(object, undefined))) return 'Map'
    if (brand(() => Set.prototype.has.call(object, undefined))) return 'Set'
    if (brand(() => WeakMap.prototype.has.call(object, {}))) return 'WeakMap'
    if (brand(() => WeakSet.prototype.has.call(object, {}))) return 'WeakSet'
    if (brand(() => getter(ArrayBuffer.prototype, 'byteLength').call(object))) return 'ArrayBuffer'
    if (tag(object) === '[object Promise]') return 'Promise'
    return ''
  }

  const errorText = (error: Error): string => {
    let name = 'Error'
    let message = ''
    try {
      name = String(error.name || nameOf(error) || 'Error')
      message = String(error.message ?? '')
    } catch {}
    return message ? `${name}: ${message}` : name
  }

  const wrap = (prefix: string, open: string, close: string, items: string[], depth: number): string => {
    const head = prefix ? `${prefix} ` : ''
    if (items.length === 0) return `${head}${open}${close}`
    const line = `${head}${open} ${items.join(', ')} ${close}`
    if (line.length <= WIDTH && !items.some((i) => i.includes('\n'))) return line
    const pad = '  '.repeat(depth + 1)
    return `${head}${open}\n${items.map((i) => pad + i).join(',\n')}\n${'  '.repeat(depth)}${close}`
  }

  const props = (object: object, seen: object[], depth: number, skip: (key: string) => boolean): string[] => {
    const out: string[] = []
    let keys: (string | symbol)[] = []
    try {
      keys = Reflect.ownKeys(object)
    } catch {
      return out
    }
    for (const key of keys) {
      if (typeof key === 'string' && skip(key)) continue
      let descriptor: PropertyDescriptor | undefined
      try {
        descriptor = Object.getOwnPropertyDescriptor(object, key)
      } catch {}
      if (!descriptor?.enumerable) continue
      const shown =
        descriptor.get || descriptor.set
          ? descriptor.get && descriptor.set
            ? '[Getter/Setter]'
            : descriptor.get
              ? '[Getter]'
              : '[Setter]'
          : format(descriptor.value, seen, depth + 1)
      out.push(`${keyOf(key)}: ${shown}`)
    }
    return out
  }

  const format = (item: unknown, seen: object[], depth: number): string => {
    switch (typeof item) {
      case 'string':
        return depth === 0 ? item : quote(item)
      case 'number':
        return Object.is(item, -0) ? '-0' : String(item)
      case 'bigint':
        return `${item}n`
      case 'symbol':
        return String(item)
      case 'undefined':
        return 'undefined'
      case 'boolean':
        return String(item)
      case 'function': {
        const text = fnText(item as (...args: never[]) => unknown)
        const extra = depth > MAX_DEPTH ? [] : props(item, seen, depth, (k) => k === 'prototype')
        return extra.length ? wrap(text, '{', '}', extra, depth) : text
      }
    }
    if (item === null) return 'null'
    const object = item as object
    if (seen.includes(object)) return '[Circular]'
    const kind = kindOf(object)
    if (kind === 'Error') return depth === 0 ? errorText(object as Error) : `[${errorText(object as Error)}]`
    if (kind === 'Date') {
      const time = Date.prototype.getTime.call(object)
      return Number.isNaN(time) ? 'Invalid Date' : Date.prototype.toISOString.call(object)
    }
    if (kind === 'RegExp') return RegExp.prototype.toString.call(object)
    if (kind === 'WeakMap' || kind === 'WeakSet') return `${nameOf(object) || kind} { <items unknown> }`
    if (kind === 'Promise') return 'Promise { <unknown> }'
    const name = nameOf(object)
    if (depth > MAX_DEPTH) return Array.isArray(object) ? '[Array]' : `[${name || 'Object'}]`
    const inner = [...seen, object]
    if (kind === 'Map') {
      const entries = [...Map.prototype.entries.call(object)] as [unknown, unknown][]
      const items = entries.map(([k, v]) => `${format(k, inner, depth + 1)} => ${format(v, inner, depth + 1)}`)
      return wrap(`${name || 'Map'}(${entries.length})`, '{', '}', items, depth)
    }
    if (kind === 'Set') {
      const values = [...Set.prototype.values.call(object)] as unknown[]
      const items = values.map((v) => format(v, inner, depth + 1))
      return wrap(`${name || 'Set'}(${values.length})`, '{', '}', items, depth)
    }
    if (ArrayBuffer.isView(object) && tag(object) !== '[object DataView]') {
      const list = Array.from(object as unknown as ArrayLike<number | bigint>)
      const items = list.slice(0, MAX_ITEMS).map((v) => format(v, inner, depth + 1))
      if (list.length > MAX_ITEMS) items.push(`… ${list.length - MAX_ITEMS} more items`)
      return wrap(`${name}(${list.length})`, '[', ']', items, depth)
    }
    if (kind === 'ArrayBuffer')
      return `ArrayBuffer { byteLength: ${getter(ArrayBuffer.prototype, 'byteLength').call(object)} }`
    if (Array.isArray(object)) {
      const items: string[] = []
      let holes = 0
      const shown = Math.min(object.length, MAX_ITEMS)
      const flush = () => {
        if (holes) items.push(`<${holes} empty item${holes === 1 ? '' : 's'}>`)
        holes = 0
      }
      for (let i = 0; i < shown; i++) {
        if (!Object.hasOwn(object, i)) {
          holes++
          continue
        }
        flush()
        items.push(format(object[i], inner, depth + 1))
      }
      flush()
      const more = object.length - shown
      if (more > 0) items.push(`… ${more} more item${more === 1 ? '' : 's'}`)
      items.push(...props(object, inner, depth, (k) => k === 'length' || /^(0|[1-9]\d*)$/.test(k)))
      return wrap(name === 'Array' ? '' : name, '[', ']', items, depth)
    }
    const items = props(object, inner, depth, () => false)
    return wrap(name === 'Object' ? '' : name, '{', '}', items, depth)
  }

  try {
    return format(value, [], 0)
  } catch {
    return '[object]'
  }
}
