import { createHash } from 'node:crypto'

export function serverFnUrl(file: string, name: string): RegExp {
  const id = createHash('sha256').update(`${file}--${name}_createServerFn_handler`).digest('hex')
  return new RegExp(`/_serverFn/${id}(\\?|$)`)
}
