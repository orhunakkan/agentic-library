import { describe, expect, it } from 'vitest'
import { minutesFor, readTimeText } from '~/shared/articles/read-time'

describe('minutesFor', () => {
  it('is at least a minute', () => {
    expect(minutesFor(0)).toBe(1)
    expect(minutesFor(100)).toBe(1)
  })
  it('rounds at 230 words a minute', () => {
    expect(minutesFor(230)).toBe(1)
    expect(minutesFor(1840)).toBe(8)
    expect(minutesFor(1955)).toBe(9)
  })
  it('says it as the cards do', () => expect(readTimeText(1840)).toBe('8 min read'))
})
