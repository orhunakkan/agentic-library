import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import type { ReaderContext } from '~/shared/content/reader-view'
import { trimCatalog } from '~/shared/offline/book'
import { catalogueBook, loadBook, loadCatalog } from '../repository.ts'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)

/** Builds each slug's answer once for every caller; a null answer or a failure is forgotten, to be built again. */
export function oncePerSlug<T>(build: (slug: string) => Promise<T | null>): (slug: string) => Promise<T | null> {
  const answers = new Map<string, Promise<T | null>>()
  return (slug) => {
    let answer = answers.get(slug)
    if (!answer) {
      answer = build(slug)
      answers.set(slug, answer)
      void answer.then((a) => a === null && answers.delete(slug)).catch(() => answers.delete(slug))
    }
    return answer
  }
}

export const catalogueVersion = oncePerSlug(async (slug) => {
  const [catalog, meta, content] = await Promise.all([loadCatalog(), catalogueBook(slug), loadBook(slug)])
  return meta && content ? hash([trimCatalog(catalog, meta), content]) : null
})

export function privateVersion(
  context: ReaderContext,
  outline: readonly { slug: string; title: string; pageCount: number }[],
): string {
  return hash([context, outline.map((c) => [c.slug, c.title, c.pageCount])])
}
