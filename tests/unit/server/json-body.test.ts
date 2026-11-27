import { describe, expect, it } from 'vitest'
import { readBytesBody, readForm, readJsonBody, readJsonOr } from '~/server/json-body'

const encoder = new TextEncoder()

function post(body: BodyInit | null, headers: Record<string, string> = { 'content-type': 'application/json' }) {
  return new Request('http://localhost/x', { method: 'POST', body, headers, duplex: 'half' } as RequestInit)
}

function chunkedBody(chunks: string[], allowedPulls = chunks.length) {
  const state = { pulls: 0, cancelled: false }
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulls++
        if (state.pulls > allowedPulls) throw new Error(`read past the cap (pull ${state.pulls})`)
        const chunk = chunks[state.pulls - 1]
        if (chunk === undefined) controller.close()
        else controller.enqueue(encoder.encode(chunk))
      },
      cancel() {
        state.cancelled = true
      },
    },
    { highWaterMark: 0 },
  )
  return { stream, state }
}

describe('readJsonBody', () => {
  it.each([
    ['no content type', {}],
    ['text/plain', { 'content-type': 'text/plain' }],
    ['a look-alike type', { 'content-type': 'application/jsonp' }],
    ['form data', { 'content-type': 'application/x-www-form-urlencoded' }],
  ])('refuses %s with content-type', async (_name, headers) => {
    expect(await readJsonBody(post('{"a":1}', headers), 100)).toEqual({ ok: false, reason: 'content-type' })
  })

  it('refuses a body sent with no content-type header at all', async () => {
    const { stream } = chunkedBody(['{"a":1}'])
    const request = post(stream, {})
    expect(request.headers.get('content-type')).toBeNull()
    expect(await readJsonBody(request, 100)).toEqual({ ok: false, reason: 'content-type' })
  })

  it('accepts application/json with a charset, in any case', async () => {
    const request = post('{"a":1}', { 'content-type': 'Application/JSON; charset=utf-8' })
    expect(await readJsonBody(request, 100)).toEqual({ ok: true, value: { a: 1 } })
  })

  it('refuses a declared content-length over the cap before reading anything', async () => {
    const { stream, state } = chunkedBody(['{"a":1}'], 0)
    const request = post(stream, { 'content-type': 'application/json', 'content-length': '101' })
    expect(await readJsonBody(request, 100)).toEqual({ ok: false, reason: 'too-large' })
    expect(state.pulls).toBe(0)
  })

  it('stops reading as soon as an undeclared body passes the cap, and cancels the rest', async () => {
    const { stream, state } = chunkedBody(['"aaaaaaaa"', 'bbbbbbbbbb', 'cccccccccc', 'dddddddddd', 'eeeeeeeeee'], 3)
    expect(await readJsonBody(post(stream), 25)).toEqual({ ok: false, reason: 'too-large' })
    expect(state.pulls).toBe(3)
    expect(state.cancelled).toBe(true)
  })

  it('still refuses an oversized body when cancelling the rest fails', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode('x'.repeat(20)))
      },
      cancel() {
        throw new Error('the connection is already gone')
      },
    })
    expect(await readJsonBody(post(stream), 10)).toEqual({ ok: false, reason: 'too-large' })
  })

  it('accepts a body of exactly the cap', async () => {
    const body = JSON.stringify({ text: 'x'.repeat(40) })
    expect(await readJsonBody(post(body), encoder.encode(body).length)).toEqual({
      ok: true,
      value: { text: 'x'.repeat(40) },
    })
  })

  it('counts the cap in bytes, not characters', async () => {
    const body = JSON.stringify('€'.repeat(10))
    expect(await readJsonBody(post(body), body.length + 2)).toEqual({ ok: false, reason: 'too-large' })
  })

  it('decodes UTF-8 split across chunks', async () => {
    const bytes = encoder.encode('{"word":"çiçek"}')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 10))
        controller.enqueue(bytes.slice(10))
        controller.close()
      },
    })
    expect(await readJsonBody(post(stream), 100)).toEqual({ ok: true, value: { word: 'çiçek' } })
  })

  it.each([
    ['malformed JSON', '{"a":'],
    ['an empty body', ''],
    ['trailing garbage', '{"a":1} x'],
  ])('answers invalid for %s', async (_name, body) => {
    expect(await readJsonBody(post(body), 100)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('answers invalid when there is no body at all', async () => {
    expect(await readJsonBody(post(null), 100)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('gives the parsed value of a valid body', async () => {
    const value = { title: 'A book', chapters: [{ blocks: [] }], n: 3, ok: true, none: null }
    expect(await readJsonBody(post(JSON.stringify(value)), 1000)).toEqual({ ok: true, value })
  })
})

describe('readJsonOr', () => {
  const refuse = (status: number, problem: string) => Response.json({ problem }, { status })

  it('gives the parsed value of a valid body', async () => {
    expect(await readJsonOr(post('{"a":1}'), 100, refuse)).toEqual({ ok: true, value: { a: 1 } })
  })

  it.each([
    ['content-type', post('{}', { 'content-type': 'text/plain' }), 415],
    ['too-large', post('{"a":"0123456789"}'), 413],
    ['invalid', post('{"a":'), 400],
  ])('answers %s with refuse, given its status', async (problem, request, status) => {
    const body = await readJsonOr(request, 10, refuse)
    if (body.ok) throw new Error('expected a refusal')
    expect(body.response.status).toBe(status)
    expect(await body.response.json()).toEqual({ problem })
  })
})

describe('readForm', () => {
  it('gives the fields of a form post', async () => {
    const form = await readForm(post('intent=delete&id=1', { 'content-type': 'application/x-www-form-urlencoded' }))
    expect(form?.get('intent')).toBe('delete')
    expect(form?.get('id')).toBe('1')
  })

  it('answers null for a body that is not a form', async () => {
    expect(await readForm(post('{}'))).toBeNull()
  })

  describe('with a cap', () => {
    const urlencoded = { 'content-type': 'application/x-www-form-urlencoded' }

    it('gives the fields of a urlencoded or multipart form within it', async () => {
      expect((await readForm(post('intent=delete', urlencoded), 16))?.get('intent')).toBe('delete')
      const multipart = new FormData()
      multipart.set('intent', 'save')
      const sent = new Request('http://localhost/x', { method: 'POST', body: multipart })
      expect((await readForm(sent, 1024))?.get('intent')).toBe('save')
    })

    it('answers null past the cap, without reading the rest', async () => {
      expect(await readForm(post('intent=delete', urlencoded), 8)).toBeNull()
      const { stream, state } = chunkedBody(['intent=', 'delete', 'more'], 2)
      expect(await readForm(post(stream, urlencoded), 10)).toBeNull()
      expect(state.cancelled).toBe(true)
    })

    it('answers null for a body that is not a form, or names no type', async () => {
      expect(await readForm(post('{}'), 64)).toBeNull()
      expect(await readForm(post(encoder.encode('intent=delete'), {}), 64)).toBeNull()
      expect(await readForm(post('x', { 'content-type': 'multipart/form-data' }), 64)).toBeNull()
    })
  })
})

describe('readBytesBody', () => {
  const TYPES = ['image/jpeg', 'image/png']
  const image = (body: BodyInit | null, type = 'image/jpeg') => post(body, { 'content-type': type })

  it('gives the bytes and the type the request named', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    expect(await readBytesBody(image(bytes, 'image/JPEG; q=1'), 10, TYPES)).toEqual({
      ok: true,
      bytes,
      type: 'image/jpeg',
    })
  })

  it('refuses a type it doesn’t take, a body over the cap, and an empty body', async () => {
    expect(await readBytesBody(image('x', 'image/webp'), 10, TYPES)).toEqual({ ok: false, reason: 'content-type' })
    expect(await readBytesBody(post(new Uint8Array([1]), {}), 10, TYPES)).toEqual({ ok: false, reason: 'content-type' })
    expect(await readBytesBody(image('0123456789A'), 10, TYPES)).toEqual({ ok: false, reason: 'too-large' })
    expect(await readBytesBody(image(''), 10, TYPES)).toEqual({ ok: false, reason: 'invalid' })
    expect(await readBytesBody(image(null), 10, TYPES)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('stops reading once the body passes the cap', async () => {
    const { stream, state } = chunkedBody(['01234', '56789', 'AB', 'never'], 3)
    expect(await readBytesBody(image(stream), 10, TYPES)).toEqual({ ok: false, reason: 'too-large' })
    expect(state.cancelled).toBe(true)
  })
})
