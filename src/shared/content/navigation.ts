export interface NavChapter {
  title: string
  pageHrefs: readonly string[]
}

export type NavTarget =
  | { kind: 'page'; href: string }
  | { kind: 'chapter'; href: string; title: string }
  | { kind: 'start' }
  | { kind: 'end' }

export interface Navigation {
  prev: NavTarget
  next: NavTarget
  status: { chapterNumber: number; page: number; pageCount: number }
  progress: { position: number; total: number }
  dots: { href: string; current: boolean }[]
}

export const pagedHref = (bookSlug: string, page: number) => `/read/${bookSlug}/${page}`

export const chapterPageHref = (bookSlug: string, chapterSlug: string, n: number) =>
  n <= 1 ? `/read/${bookSlug}/${chapterSlug}` : `/read/${bookSlug}/${chapterSlug}/${n}`

export function pageLabel(place: { printedPage: number } | { chapterIndex: number; page: number }): string {
  return 'printedPage' in place ? `p. ${place.printedPage}` : `Ch. ${place.chapterIndex + 1} · p. ${place.page}`
}

export function buildNavigation(chapters: readonly NavChapter[], chapterIndex: number, pageIndex: number): Navigation {
  const chapter = chapters[chapterIndex]
  if (!chapter) throw new Error(`No chapter at index ${chapterIndex}`)
  const pages = chapter.pageHrefs

  let prev: NavTarget = { kind: 'start' }
  const prevPage = pages[pageIndex - 1]
  const prevChapter = chapters[chapterIndex - 1]
  const prevChapterLast = prevChapter?.pageHrefs.at(-1)
  if (prevPage) prev = { kind: 'page', href: prevPage }
  else if (prevChapter && prevChapterLast) prev = { kind: 'chapter', href: prevChapterLast, title: prevChapter.title }

  let next: NavTarget = { kind: 'end' }
  const nextPage = pages[pageIndex + 1]
  const nextChapter = chapters[chapterIndex + 1]
  if (nextPage) next = { kind: 'page', href: nextPage }
  else if (nextChapter?.pageHrefs[0])
    next = { kind: 'chapter', href: nextChapter.pageHrefs[0], title: nextChapter.title }

  const before = chapters.slice(0, chapterIndex).reduce((n, c) => n + c.pageHrefs.length, 0)
  const total = chapters.reduce((n, c) => n + c.pageHrefs.length, 0)

  return {
    prev,
    next,
    status: { chapterNumber: chapterIndex + 1, page: pageIndex + 1, pageCount: pages.length },
    progress: { position: before + pageIndex + 1, total },
    dots: pages.map((href, i) => ({ href, current: i === pageIndex })),
  }
}
