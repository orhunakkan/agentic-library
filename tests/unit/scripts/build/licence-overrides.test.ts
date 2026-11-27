import { describe, expect, it } from 'vitest'
import { LICENCE_OVERRIDES } from '../../../../scripts/build/licence-overrides.ts'

describe('LICENCE_OVERRIDES', () => {
  it('names no removed repository as a source', () => {
    const notes = Object.values(LICENCE_OVERRIDES).map((override) => override.note)
    expect(notes.filter((note) => /github\.com\/microsoft\/onnxruntime/i.test(note))).toEqual([])
  })
})
