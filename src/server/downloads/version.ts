import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import type { ReaderContext } from '~/shared/content/reader-view'
import { trimCatalog } from '~/shared/offline/book'
import { catalogueBook, loadBook, loadCatalog } from '../repository.ts'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)

const catalogue = new Map<string, Promise<string | null>>()

export function catalogueVersion(slug: string): Promise<string | null> {
  let version = catalogue.get(slug)
  if (!version) {
    version = (async () => {
      const [catalog, meta, content] = await Promise.all([loadCatalog(), catalogueBook(slug), loadBook(slug)])
      return meta && content ? hash([trimCatalog(catalog, meta), content]) : null
    })()
    catalogue.set(slug, version)
    void version.then((v) => v === null && catalogue.delete(slug)).catch(() => catalogue.delete(slug))
  }
  return version
}

export function privateVersion(
  context: ReaderContext,
  outline: readonly { slug: string; title: string; pageCount: number }[],
): string {
  return hash([context, outline.map((c) => [c.slug, c.title, c.pageCount])])
}
