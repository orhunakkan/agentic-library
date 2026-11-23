import { beforeEach, describe, expect, it } from 'vitest'
import { ARTICLE_FETCH_LIMIT, ARTICLE_PICTURE_LIMIT } from '../rate-limit'
import { enter, IN_FLIGHT_MAX, resetPacing, takeFetch } from './pacing'

beforeEach(() => resetPacing())

describe('takeFetch', () => {
  it('allows 60 page fetches an hour, then says when the next is', () => {
    for (let i = 0; i < ARTICLE_FETCH_LIMIT.max; i++) expect(takeFetch('page', 1, 1000 + i)).toBeNull()
    expect(takeFetch('page', 1, 2000)).toEqual(new Date(1000 + ARTICLE_FETCH_LIMIT.windowMs))
    expect(takeFetch('page', 2, 2000)).toBeNull()
    expect(takeFetch('picture', 1, 2000)).toBeNull()
    expect(takeFetch('page', 1, 1000 + ARTICLE_FETCH_LIMIT.windowMs + 1)).toBeNull()
  })
  it('allows 1,200 pictures an hour', () => {
    for (let i = 0; i < ARTICLE_PICTURE_LIMIT.max; i++) takeFetch('picture', 1, i)
    expect(takeFetch('picture', 1, 5000)).not.toBeNull()
  })
})

describe('enter', () => {
  it('caps the server’s fetches in flight, by kind', () => {
    const pages = Array.from({ length: IN_FLIGHT_MAX.page }, () => enter('page'))
    expect(pages.every(Boolean)).toBe(true)
    expect(enter('page')).toBeNull()
    expect(enter('picture')).not.toBeNull()
    pages[0]?.()
    pages[0]?.()
    const again = enter('page')
    expect(again).not.toBeNull()
    expect(enter('page')).toBeNull()
  })
})
