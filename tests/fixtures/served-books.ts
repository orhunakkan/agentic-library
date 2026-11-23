import { existsSync, readdirSync, readFileSync } from 'node:fs'
import type { BookContent } from '~/shared/content/schema'
import { CONTENT_FOLDERS } from '../content-folders.ts'

export function servedBooks(): { file: string; book: BookContent }[] {
  return CONTENT_FOLDERS.map((folder) => `${folder}/books`)
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({ file: `${dir}/${f}`, book: JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as BookContent })),
    )
}
