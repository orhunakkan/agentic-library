export function libraryPathFor(pathname: string): string | null {
  return /^\/works(\/|$)/.test(pathname) ? `/library${pathname.slice('/works'.length)}` : null
}
