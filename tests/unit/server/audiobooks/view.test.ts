import { describe, expect, it } from 'vitest'
import { audioEpisodes, audioFileHref } from '~/server/audiobooks/view'

describe('audioEpisodes', () => {
  it('makes each chapter an episode, its id its position and its address its file', () => {
    const id = '6f1c0000-0000-4000-8000-000000000000'
    expect(audioFileHref(id, 2)).toBe(`/account/books/${id}/audio/2`)
    expect(
      audioEpisodes(id, [
        { position: 1, title: 'One', fileN: 1, startMs: 0, durationMs: 3000 },
        { position: 2, title: 'Two', fileN: 1, startMs: 3000, durationMs: 4000 },
      ]),
    ).toEqual([
      {
        id: '1',
        slug: 'chapter-1',
        title: 'One',
        number: 1,
        durationMs: 3000,
        audioUrl: `/account/books/${id}/audio/1`,
      },
      {
        id: '2',
        slug: 'chapter-2',
        title: 'Two',
        number: 2,
        durationMs: 4000,
        audioUrl: `/account/books/${id}/audio/1`,
      },
    ])
  })
})
