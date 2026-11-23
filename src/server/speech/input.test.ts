import { describe, expect, it } from 'vitest'
import { parseSpeakInput } from './input'

const span = {
  book: 'pride-and-prejudice',
  chapter: 0,
  voice: 'StubVoiceAria01',
  position: { chapter: 'chapter-1', page: 1 },
  start: 0,
  end: 57,
}

describe('parseSpeakInput', () => {
  it('takes a span on a page, at 64 kbps unless asked for the standard rate', () => {
    expect(parseSpeakInput(span)).toEqual({ ...span, format: 'low', kind: 'span' })
    expect(parseSpeakInput({ ...span, format: 'standard' })).toMatchObject({ format: 'standard' })
    expect(parseSpeakInput({ ...span, position: { printedPage: 112 } })).toMatchObject({
      position: { printedPage: 112 },
    })
  })

  it('takes the chapter’s intro instead of a span, never both', () => {
    const intro = { book: 'u-6f1c0000-0000-4000-8000-000000000001', chapter: 3, voice: 'Abc', intro: true }
    expect(parseSpeakInput(intro)).toEqual({ ...intro, format: 'low', kind: 'intro', intro: undefined })
    expect(parseSpeakInput({ ...intro, intro: false })).toBeNull()
    expect(parseSpeakInput({ ...span, intro: true })).toBeNull()
    expect(parseSpeakInput({ ...intro, start: 0 })).toBeNull()
  })

  it('refuses unknown fields, text above all', () => {
    expect(parseSpeakInput({ ...span, text: 'Say this instead.' })).toBeNull()
    expect(parseSpeakInput({ ...span, model: 'eleven_v4' })).toBeNull()
    expect(parseSpeakInput(null)).toBeNull()
    expect(parseSpeakInput([span])).toBeNull()
    expect(parseSpeakInput('span')).toBeNull()
  })

  it('checks every field’s limits', () => {
    const bad: Record<string, unknown>[] = [
      { book: 'Not A Slug' },
      { book: 'x'.repeat(201) },
      { book: undefined },
      { chapter: -1 },
      { chapter: 1.5 },
      { chapter: 100_001 },
      { chapter: '0' },
      { voice: '' },
      { voice: '../../v1/user' },
      { voice: 'x'.repeat(65) },
      { voice: 42 },
      { format: 'high' },
      { position: { chapter: 'chapter-1' } },
      { position: { chapter: 'chapter-1', page: 0 } },
      { position: undefined },
      { start: -1 },
      { start: 57 },
      { start: 60 },
      { end: 100_001 },
      { end: 2.5 },
      { start: undefined },
    ]
    for (const patch of bad) expect(parseSpeakInput({ ...span, ...patch }), JSON.stringify(patch)).toBeNull()
    expect(parseSpeakInput({ ...span, start: 0, end: 100_000 })).not.toBeNull()
    expect(parseSpeakInput({ ...span, chapter: 100_000 })).not.toBeNull()
  })
})
