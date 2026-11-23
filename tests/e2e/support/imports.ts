import { join } from 'node:path'
import type { APIRequestContext } from '@playwright/test'

export const FIXTURE = {
  epub: join(import.meta.dirname, '../fixtures/imports/field-notes.epub'),
  markdown: join(import.meta.dirname, '../fixtures/imports/garden-diary.md'),
}

export interface ApiBook {
  id: string
  slug: string
  href: string
}

export function postJson(request: APIRequestContext, baseURL: string, path: string, data: unknown) {
  return request.post(path, {
    data: JSON.stringify(data),
    headers: { origin: new URL(baseURL).origin, 'content-type': 'application/json' },
    maxRedirects: 0,
  })
}

export async function importViaApi(
  request: APIRequestContext,
  baseURL: string,
  { title, chapters, picture }: { title: string; chapters: { title: string; text: string }[]; picture?: Uint8Array },
): Promise<ApiBook> {
  const start = await postJson(request, baseURL, '/account/books/new', {
    title,
    author: 'API Tester',
    language: 'en',
    chapterCount: chapters.length,
    ...(picture ? { images: { count: 1, bytes: picture.length } } : {}),
  })
  if (start.status() !== 201) throw new Error(`/account/books/new answered ${start.status()}: ${await start.text()}`)
  const { id } = (await start.json()) as { id: string }
  if (picture) {
    const upload = await request.post(`/account/books/${id}/images/1`, {
      data: Buffer.from(picture),
      headers: { origin: new URL(baseURL).origin, 'content-type': 'image/png' },
    })
    if (!upload.ok()) throw new Error(`picture 1 answered ${upload.status()}`)
  }
  for (const [i, chapter] of chapters.entries()) {
    const figure = picture && i === 0 ? [{ type: 'image', image: 1, alt: 'A test picture' }] : []
    const response = await postJson(request, baseURL, `/account/books/${id}/chapters/${i}`, {
      title: chapter.title,
      blocks: [{ type: 'paragraph', runs: [{ text: chapter.text }] }, ...figure],
    })
    if (!response.ok()) throw new Error(`chapter ${i} answered ${response.status()}`)
  }
  const finish = await postJson(request, baseURL, `/account/books/${id}/finish`, {})
  if (!finish.ok()) throw new Error(`finish answered ${finish.status()}`)
  const first = (chapters[0]?.title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return { id, slug: `u-${id}`, href: `/read/u-${id}/${first}` }
}
