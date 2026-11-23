import { createMiddleware, createStart } from '@tanstack/react-start'
import { privateHeaders } from './server/private-pages'

const noStoreForAccounts = createMiddleware().server(async ({ request, pathname, next }) => {
  const result = await next()
  const headers = privateHeaders(pathname, request.headers.get('cookie'))
  if (!headers) return result
  const set = (target: Headers) => {
    for (const [name, value] of Object.entries(headers)) target.set(name, value)
  }
  try {
    set(result.response.headers)
    return result
  } catch {
    const response = new Response(result.response.body, result.response)
    set(response.headers)
    return { ...result, response }
  }
})

export const startInstance = createStart(() => ({ requestMiddleware: [noStoreForAccounts] }))
