import { describe, expect, it, vi } from 'vitest'
import { createRatingSender, type RatingSnapshot } from '~/client/features/ratings/rating-sender'
import type { RatingResult } from '~/client/features/ratings/ratings-client'
import type { Stars } from '~/shared/ratings/ratings'

function harness(saved: Stars | null = null) {
  const requests: { stars: Stars | null; answer: (result: RatingResult) => Promise<void> }[] = []
  const snapshots: RatingSnapshot[] = []
  const send = vi.fn(
    (stars: Stars | null) =>
      new Promise<RatingResult>((resolve) => {
        requests.push({
          stars,
          answer: async (result) => {
            resolve(result)
            await new Promise((r) => setTimeout(r, 0))
          },
        })
      }),
  )
  const sender = createRatingSender({ saved, send, onChange: (s) => snapshots.push(s) })
  const ok = (stars: Stars | null): RatingResult => ({ ok: true, value: stars })
  return { sender, send, requests, snapshots, ok }
}

describe('createRatingSender', () => {
  it('shows a choice at once and sends it', async () => {
    const { sender, send, requests, ok } = harness()
    sender.choose(4)
    expect(sender.snapshot()).toEqual({ shown: 4, saved: null, problem: null })
    expect(send).toHaveBeenCalledWith(4)
    await requests[0]?.answer(ok(4))
    expect(sender.snapshot()).toEqual({ shown: 4, saved: 4, problem: null })
  })

  it('sends only the newest of the choices made during one request', async () => {
    const { sender, send, requests, ok } = harness()
    sender.choose(1)
    sender.choose(2)
    sender.choose(3)
    sender.choose(5)
    expect(send).toHaveBeenCalledTimes(1)
    expect(sender.snapshot().shown).toBe(5)
    await requests[0]?.answer(ok(1))
    expect(send.mock.calls.map((c) => c[0])).toEqual([1, 5])
    expect(sender.snapshot()).toEqual({ shown: 5, saved: 1, problem: null })
    await requests[1]?.answer(ok(5))
    expect(sender.snapshot()).toEqual({ shown: 5, saved: 5, problem: null })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('sends nothing more when the waiting choice is what was just saved', async () => {
    const { sender, send, requests, ok } = harness()
    sender.choose(2)
    sender.choose(4)
    sender.choose(2)
    await requests[0]?.answer(ok(2))
    expect(send).toHaveBeenCalledTimes(1)
    expect(sender.snapshot()).toEqual({ shown: 2, saved: 2, problem: null })
  })

  it('goes back to the saved rating on a refusal, drops the waiting choice and says why', async () => {
    const { sender, send, requests, ok } = harness(3)
    sender.choose(5)
    sender.choose(1)
    await requests[0]?.answer({ ok: false, problem: 'offline' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(sender.snapshot()).toEqual({ shown: 3, saved: 3, problem: 'offline' })
    sender.choose(2)
    await requests[1]?.answer(ok(2))
    expect(sender.snapshot()).toEqual({ shown: 2, saved: 2, problem: null })
  })

  it('keeps the problem while a change is on its way', async () => {
    const { sender, requests } = harness(3)
    sender.choose(5)
    await requests[0]?.answer({ ok: false, problem: 'signed_out' })
    sender.choose(4)
    expect(sender.snapshot()).toEqual({ shown: 4, saved: 3, problem: 'signed_out' })
  })

  it('treats a request that throws as failed', async () => {
    const onChange = vi.fn()
    const sender = createRatingSender({ saved: 2, send: () => Promise.reject(new Error('boom')), onChange })
    sender.choose(4)
    await new Promise((r) => setTimeout(r, 0))
    expect(sender.snapshot()).toEqual({ shown: 2, saved: 2, problem: 'failed' })
  })

  it('clears a rating', async () => {
    const { sender, send, requests, ok } = harness(4)
    sender.choose(null)
    expect(send).toHaveBeenCalledWith(null)
    expect(sender.snapshot().shown).toBeNull()
    await requests[0]?.answer(ok(null))
    expect(sender.snapshot()).toEqual({ shown: null, saved: null, problem: null })
  })

  it('ends on the newest choice whatever order the answers come in', async () => {
    const { sender, requests, ok } = harness()
    sender.choose(2)
    sender.choose(3)
    await requests[0]?.answer(ok(2))
    sender.choose(4)
    await requests[1]?.answer(ok(3))
    expect(requests.map((r) => r.stars)).toEqual([2, 3, 4])
    await requests[2]?.answer(ok(4))
    expect(sender.snapshot()).toEqual({ shown: 4, saved: 4, problem: null })
  })

  it('takes the loader’s value only when idle', async () => {
    const { sender, requests, ok, snapshots } = harness(1)
    sender.choose(3)
    sender.adopt(5)
    expect(sender.snapshot()).toEqual({ shown: 3, saved: 1, problem: null })
    await requests[0]?.answer(ok(3))
    sender.adopt(5)
    expect(sender.snapshot()).toEqual({ shown: 5, saved: 5, problem: null })
    const before = snapshots.length
    sender.adopt(5)
    expect(snapshots).toHaveLength(before)
  })

  it('sends nothing when the saved rating is chosen again', () => {
    const { sender, send } = harness(4)
    sender.choose(4)
    expect(send).not.toHaveBeenCalled()
    expect(sender.snapshot()).toEqual({ shown: 4, saved: 4, problem: null })
  })
})
