import { describe, expect, it } from 'vitest'
import { offerFor, offerText } from '~/client/features/sync/offer'
import type { ReadingPlace } from '~/shared/sync/sync'

const place: ReadingPlace = {
  book: 'pride-and-prejudice',
  bookTitle: 'Pride and Prejudice',
  chapterTitle: 'Chapter 8',
  href: '/read/pride-and-prejudice/chapter-8/3',
  label: 'Ch. 8 · p. 3',
  position: { chapter: 'chapter-8', page: 3 },
  at: 1000,
  device: 'Safari on iPhone',
}
const offer = (over: Partial<Parameters<typeof offerFor>[0]> = {}) =>
  offerFor({ account: place, currentHref: '/read/pride-and-prejudice/chapter-1', baseline: 0, dismissedAt: 0, ...over })

describe('offerFor', () => {
  it('offers a place on another page that is newer than the baseline', () => {
    expect(offer()).toBe(place)
    expect(offer({ baseline: 999 })).toBe(place)
  })

  it('offers nothing for the same page, an older or equal place, a dismissed one, or none', () => {
    expect(offer({ currentHref: place.href })).toBeNull()
    expect(offer({ baseline: 1000 })).toBeNull()
    expect(offer({ baseline: 2000 })).toBeNull()
    expect(offer({ dismissedAt: 1000 })).toBeNull()
    expect(offer({ account: null })).toBeNull()
    expect(offer({ account: { ...place, at: 1001 }, dismissedAt: 1000 })).toEqual({ ...place, at: 1001 })
  })
})

describe('offerText', () => {
  it('says where, on which device and when', () => {
    expect(offerText(place, 1000 + 2 * 3_600_000)).toBe('You were on Ch. 8 · p. 3 in Safari on iPhone, 2 hours ago.')
  })

  it('gives a paged book’s printed page', () => {
    expect(offerText({ ...place, label: 'p. 112', device: 'Chrome on macOS' }, 1000)).toBe(
      'You were on p. 112 in Chrome on macOS, just now.',
    )
  })

  it('says another device when the device has no name', () => {
    expect(offerText({ ...place, device: 'Unknown device' }, 1000 + 5 * 60_000)).toBe(
      'You were on Ch. 8 · p. 3 on another device, 5 minutes ago.',
    )
    expect(offerText({ ...place, device: '' }, 1000)).toBe('You were on Ch. 8 · p. 3 on another device, just now.')
  })
})
