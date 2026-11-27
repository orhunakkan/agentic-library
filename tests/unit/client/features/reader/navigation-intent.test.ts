import { describe, expect, it } from 'vitest'
import {
  arrival,
  canTurn,
  IDLE,
  type Intent,
  type IntentEvent,
  next,
  showsLoadingBar,
} from '~/client/features/reader/navigation-intent'

const A = '/read/essays/history/2'
const B = '/read/essays/history/3'

const given = (...events: IntentEvent[]): Intent => events.reduce(next, IDLE)

describe('arrival', () => {
  it('with nothing pending, fades, closes overlays and places the page in the column', () => {
    expect(arrival(IDLE, A, false)).toEqual({
      followedScroll: false,
      turn: 'fade',
      closeOverlays: true,
      column: 'place',
    })
  })
})

describe('a page turn', () => {
  it('slides its arrival and closes overlays; the arrival uses it up', () => {
    const turned = given({ type: 'turned', turn: 'forward' })
    expect(arrival(turned, A, false)).toEqual({
      followedScroll: false,
      turn: 'forward',
      closeOverlays: true,
      column: 'place',
    })
    expect(arrival(next(turned, { type: 'arrived', href: A }), B, false).turn).toBe('fade')
  })

  it('blocks further turns until a page arrives', () => {
    expect(canTurn(IDLE)).toBe(true)
    const turned = given({ type: 'turned', turn: 'back' })
    expect(canTurn(turned)).toBe(false)
    expect(canTurn(next(turned, { type: 'arrived', href: A }))).toBe(true)
  })

  it('that fails frees the lock, so the reader can turn again', () => {
    const failed = given({ type: 'turned', turn: 'back' }, { type: 'turnFailed' })
    expect(canTurn(failed)).toBe(true)
  })

  it('that fails leaves no slide pending: a link that arrives next fades', () => {
    const failed = given({ type: 'turned', turn: 'back' }, { type: 'turnFailed' })
    expect(arrival(failed, A, false).turn).toBe('fade')
  })
})

describe('the address following the scroll', () => {
  it('hides the loading bar, and its arrival only remembers the page', () => {
    const scrolled = given({ type: 'scrolledTo', href: A })
    expect(showsLoadingBar(IDLE)).toBe(true)
    expect(showsLoadingBar(scrolled)).toBe(false)
    expect(arrival(scrolled, A, false)).toEqual({
      followedScroll: true,
      turn: null,
      closeOverlays: false,
      column: 'leave',
    })
    const arrived = next(scrolled, { type: 'arrived', href: A })
    expect(arrived.scrolledTo).toBeNull()
    expect(showsLoadingBar(arrived)).toBe(true)
  })

  it('that fails is cleared, unless the scroll has moved on to another page', () => {
    expect(given({ type: 'scrolledTo', href: A }, { type: 'scrollFailed', href: A })).toEqual(IDLE)
    const movedOn = given({ type: 'scrolledTo', href: A }, { type: 'scrollFailed', href: B })
    expect(movedOn.scrolledTo).toBe(A)
  })

  it('arriving there keeps a pending turn and its lock', () => {
    const intent = given(
      { type: 'turned', turn: 'forward' },
      { type: 'scrolledTo', href: A },
      { type: 'arrived', href: A },
    )
    expect(intent).toEqual({ turn: 'forward', turning: true, scrolledTo: null })
  })

  it('is left alone by the column even while the followed voice is on that page', () => {
    expect(arrival(given({ type: 'scrolledTo', href: A }), A, true).column).toBe('leave')
  })

  it('arriving elsewhere is a navigation like any other, and clears the scroll', () => {
    const scrolled = given({ type: 'scrolledTo', href: A })
    expect(arrival(scrolled, B, false)).toEqual({
      followedScroll: false,
      turn: 'fade',
      closeOverlays: true,
      column: 'place',
    })
    expect(next(scrolled, { type: 'arrived', href: B })).toEqual(IDLE)
  })
})

describe('a voice turn', () => {
  it('slides forward and closes overlays, without the page turn’s lock', () => {
    const voiced = given({ type: 'voiceTurned' })
    expect(canTurn(voiced)).toBe(true)
    expect(arrival(voiced, B, false)).toEqual({
      followedScroll: false,
      turn: 'forward',
      closeOverlays: true,
      column: 'place',
    })
  })

  it('that fails leaves no slide pending: a link that arrives next fades', () => {
    const failed = given({ type: 'voiceTurned' }, { type: 'voiceTurnFailed' })
    expect(arrival(failed, A, false).turn).toBe('fade')
  })

  it('leaves the column to the followed voice, which places the page itself', () => {
    expect(arrival(IDLE, B, true)).toEqual({
      followedScroll: false,
      turn: 'fade',
      closeOverlays: true,
      column: 'voice',
    })
  })

  describe('during a scroll-driven navigation', () => {
    const both = given({ type: 'scrolledTo', href: A }, { type: 'voiceTurned' })

    it('keeps the loading bar hidden while both are pending', () => {
      expect(showsLoadingBar(both)).toBe(false)
    })

    it('arriving at the voice’s page first slides forward, closes overlays and clears the scroll', () => {
      expect(arrival(both, B, false)).toEqual({
        followedScroll: false,
        turn: 'forward',
        closeOverlays: true,
        column: 'place',
      })
      expect(next(both, { type: 'arrived', href: B })).toEqual(IDLE)
    })

    it('arriving at the scrolled-to page first only follows it, and the voice’s slide waits for its page', () => {
      expect(arrival(both, A, false).followedScroll).toBe(true)
      const scrolledIn = next(both, { type: 'arrived', href: A })
      expect(arrival(scrolledIn, B, false).turn).toBe('forward')
    })
  })
})

describe('arrival is pure', () => {
  it('gives the same answer twice and leaves the intent as it was', () => {
    const intent = given({ type: 'turned', turn: 'back' }, { type: 'scrolledTo', href: A })
    const copy = structuredClone(intent)
    expect(arrival(intent, A, false)).toEqual(arrival(intent, A, false))
    expect(arrival(intent, B, true)).toEqual(arrival(intent, B, true))
    expect(intent).toEqual(copy)
  })
})
