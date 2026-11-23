export const QUERY_MAX = 120

export function queryOf(text: string): string | undefined {
  return text === '' ? undefined : text.slice(0, QUERY_MAX)
}

export function textForQuery(text: string, q: string | undefined, latest: string | undefined): string {
  if (q !== latest || queryOf(text) === q) return text
  return q ?? ''
}
