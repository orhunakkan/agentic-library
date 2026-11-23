import '@tanstack/react-start/server-only'

export type JsonBodyProblem = 'content-type' | 'too-large' | 'invalid'

export type JsonBody = { ok: true; value: unknown } | { ok: false; reason: JsonBodyProblem }

export const PROBLEM_STATUS: Record<JsonBodyProblem, number> = { 'content-type': 415, 'too-large': 413, invalid: 400 }

export async function readCapped(message: Request | Response, maxBytes: number): Promise<Buffer | null> {
  if (Number(message.headers.get('content-length') ?? 0) > maxBytes) return null
  if (!message.body) return Buffer.alloc(0)
  const reader = message.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBody> {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? ''))
    return { ok: false, reason: 'content-type' }
  const bytes = await readCapped(request, maxBytes)
  if (!bytes) return { ok: false, reason: 'too-large' }
  try {
    return { ok: true, value: JSON.parse(bytes.toString('utf8')) }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

export type JsonOrRefusal = { ok: true; value: unknown } | { ok: false; response: Response }

export async function readJsonOr(
  request: Request,
  maxBytes: number,
  refuse: (status: number, problem: JsonBodyProblem) => Response,
): Promise<JsonOrRefusal> {
  const body = await readJsonBody(request, maxBytes)
  return body.ok ? body : { ok: false, response: refuse(PROBLEM_STATUS[body.reason], body.reason) }
}

export async function readForm(request: Request, maxBytes?: number): Promise<FormData | null> {
  try {
    if (maxBytes === undefined) return await request.formData()
    const bytes = await readCapped(request, maxBytes)
    if (!bytes) return null
    const type = request.headers.get('content-type')
    return await new Response(new Uint8Array(bytes), { headers: type ? { 'content-type': type } : {} }).formData()
  } catch {
    return null
  }
}

export type BytesBody = { ok: true; bytes: Uint8Array; type: string } | { ok: false; reason: JsonBodyProblem }

export async function readBytesBody(request: Request, maxBytes: number, types: readonly string[]): Promise<BytesBody> {
  const type = (request.headers.get('content-type') ?? '').replace(/;.*$/s, '').trim().toLowerCase()
  if (!types.includes(type)) return { ok: false, reason: 'content-type' }
  const bytes = await readCapped(request, maxBytes)
  if (!bytes) return { ok: false, reason: 'too-large' }
  if (!bytes.length) return { ok: false, reason: 'invalid' }
  return { ok: true, bytes: new Uint8Array(bytes), type }
}
