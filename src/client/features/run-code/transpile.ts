import type { RunError } from './sandbox/protocol'

export type Transpiled = { ok: true; code: string } | { ok: false; error: RunError }

export async function transpile(code: string): Promise<Transpiled> {
  const { transform } = await import('sucrase')
  try {
    return { ok: true, code: transform(code, { transforms: ['typescript'], disableESTransforms: true }).code }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const at = /\((\d+):\d+\)\s*$/.exec(message)
    const text = message.startsWith('SyntaxError') ? message : `SyntaxError: ${message}`
    return { ok: false, error: at ? { message: text, line: Number(at[1]) } : { message: text } }
  }
}
