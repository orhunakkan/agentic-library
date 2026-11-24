import { isObject, only } from '../../shared/lib/json-shape.ts'
import { isUuid } from '../../shared/uuid.ts'

const RAW_URL_MAX = 2000
export const PATH_MAX = 1024

export function parseAdd(value: unknown): { url: string } | null {
  if (!isObject(value) || !only(value, ['url'])) return null
  return typeof value.url === 'string' && value.url.length <= RAW_URL_MAX ? { url: value.url } : null
}

export type RepoAction = 'refresh' | 'remove'

export function parseRepoAction(value: unknown): RepoAction | null {
  if (!isObject(value) || !only(value, ['intent'])) return null
  return value.intent === 'refresh' || value.intent === 'remove' ? value.intent : null
}

export function parsePath(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || value.length > PATH_MAX) return null
  if (value.includes('\0') || value.includes('\\')) return null
  // biome-ignore lint/suspicious/noControlCharactersInRegex: no control character belongs in a path Folio asks for.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  const segments = value.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null
  return value
}

export const parseView = (value: unknown): 'preview' | 'code' => (value === 'code' ? 'code' : 'preview')

export const isRepoId = (value: unknown): value is string => typeof value === 'string' && isUuid(value)
