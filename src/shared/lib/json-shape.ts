/** A parsed JSON value that is an object, not null or an array. */
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether every key of a parsed JSON object is one of `keys`. */
export const only = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((k) => keys.includes(k))

/** Whether a parsed JSON object has every one of `keys` and nothing else. */
export const exactly = (value: Record<string, unknown>, keys: readonly string[]) =>
  only(value, keys) && keys.every((k) => k in value)

/** A value that is one of `options`, such as a member of an `as const` list of codes. */
export const isOneOf = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === 'string' && (options as readonly string[]).includes(value)
