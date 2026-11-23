import { readFile } from 'node:fs/promises'
import { Resvg } from '@resvg/resvg-js'
import { createFileRoute } from '@tanstack/react-router'
import { type OgCard, renderOgSvg } from '~/server/og'
import { catalogueBook, coverFile, loadCatalog } from '~/server/repository'
import { SITE_NAME } from '~/shared/lib/site'

export const Route = createFileRoute('/og/$')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const card = await cardFor(params._splat ?? '')
        if (!card) return new Response('Not found', { status: 404 })
        const png = new Resvg(renderOgSvg(card), {
          fitTo: { mode: 'width', value: 1200 },
          font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Serif' },
        })
          .render()
          .asPng()
        return new Response(new Uint8Array(png), {
          headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' },
        })
      },
    },
  },
})

async function cardFor(path: string): Promise<OgCard | null> {
  const catalog = await loadCatalog()
  if (path === 'library.png' || path === 'works.png') {
    return {
      eyebrow: SITE_NAME,
      title: 'Library',
      subtitle: `${catalog.books.length} books in ${catalog.series.length} series. Read and listen.`,
    }
  }
  const match = /^(series|book)\/([a-z0-9-]+)\.png$/.exec(path)
  if (!match) return null
  const [, kind, slug = ''] = match
  const isWarm = (collectionSlug: string | undefined) =>
    catalog.collections.find((c) => c.slug === collectionSlug)?.tone === 'warm'
  if (kind === 'series') {
    const series = catalog.series.find((s) => s.slug === slug)
    if (!series) return null
    const count = catalog.books.filter((b) => b.seriesSlug === slug).length
    const subtitle = `${count} ${count === 1 ? 'volume' : 'volumes'}`
    return { eyebrow: 'Series', title: series.title, subtitle, warm: isWarm(series.collectionSlug) }
  }
  const book = await catalogueBook(slug)
  if (!book) return null
  const series = catalog.series.find((s) => s.slug === book.seriesSlug)
  const file = await coverFile(book.slug)
  const image = file && {
    type: file.meta.type,
    base64: (await readFile(file.path)).toString('base64'),
    width: file.meta.width,
    height: file.meta.height,
  }
  return {
    eyebrow: series?.title ?? 'Book',
    title: book.title,
    subtitle: book.author,
    book: image ? { ...book, image } : book,
    warm: isWarm(series?.collectionSlug),
  }
}
