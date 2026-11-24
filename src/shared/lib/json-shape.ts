/** A parsed JSON value that is an object, not null or an array. */
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether every key of a parsed JSON object is one of `keys`. */
export const only = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((k) => keys.includes(k))
