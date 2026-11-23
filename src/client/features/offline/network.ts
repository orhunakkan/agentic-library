import { isNotFound, isRedirect } from '@tanstack/react-router'

export function isNetworkFailure(error: unknown, nav: { onLine?: boolean } | undefined = globalNavigator()): boolean {
  if (isNotFound(error) || isRedirect(error)) return false
  if (error instanceof TypeError) return true
  return nav?.onLine === false
}

const globalNavigator = () => (typeof navigator === 'undefined' ? undefined : navigator)
