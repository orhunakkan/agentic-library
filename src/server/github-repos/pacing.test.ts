import { beforeEach, describe, expect, it } from 'vitest'
import { REPO_VIEW_LIMIT } from '../rate-limit.ts'
import { resetPacing, takeView } from './pacing.ts'

beforeEach(resetPacing)

describe('takeView', () => {
  it('allows 600 views an hour per reader, then says when the next is allowed', () => {
    const start = 1_000_000
    for (let i = 0; i < REPO_VIEW_LIMIT.max; i++) expect(takeView(1, start + i)).toBeNull()
    expect(takeView(1, start + 1000)).toEqual(new Date(start + REPO_VIEW_LIMIT.windowMs))
    expect(takeView(2, start + 1000)).toBeNull()
    expect(takeView(1, start + REPO_VIEW_LIMIT.windowMs)).toBeNull()
    expect(takeView(1, start + REPO_VIEW_LIMIT.windowMs)).toEqual(new Date(start + 1 + REPO_VIEW_LIMIT.windowMs))
  })
})
