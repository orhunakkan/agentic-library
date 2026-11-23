import { describe, expect, it } from 'vitest'
import { isAudioName, pickerAccept, pickRefusal, routePick } from './pick'

const file = (name: string) => new File(['x'], name)

describe('routePick', () => {
  it('sends a book file to the book importer, the first of several', () => {
    const epub = file('book.epub')
    expect(routePick([epub])).toEqual({ kind: 'book', file: epub })
    expect(routePick([epub, file('other.pdf')])).toEqual({ kind: 'book', file: epub })
  })

  it('sends one M4B, or any number of MP3s, to the audiobook importer', () => {
    const m4b = file('Book.M4B')
    expect(routePick([m4b])).toEqual({ kind: 'audio', files: [m4b] })
    const mp3s = [file('1.mp3'), file('2.MP3')]
    expect(routePick(mp3s)).toEqual({ kind: 'audio', files: mp3s })
    expect(routePick([file('song.flac')])).toMatchObject({ kind: 'audio' })
  })

  it('refuses several M4Bs, an M4B with MP3s, and audio with a book file', () => {
    expect(routePick([file('a.m4b'), file('b.m4b')])).toEqual({ kind: 'mixed' })
    expect(routePick([file('a.m4b'), file('b.mp3')])).toEqual({ kind: 'mixed' })
    expect(routePick([file('a.mp3'), file('b.epub')])).toEqual({ kind: 'mixed' })
    expect(routePick([])).toBeNull()
  })
})

describe('isAudioName and pickerAccept', () => {
  it('know the audio names, and accept audio only when the server takes it', () => {
    expect(isAudioName('x.aax')).toBe(true)
    expect(isAudioName('x.epub')).toBe(false)
    expect(pickerAccept(true)).toContain('.m4b,.mp3')
    expect(pickerAccept(false)).not.toContain('.mp3')
  })
})

describe('pickRefusal', () => {
  it('refuses audio on Free, and a pick at the plan’s book limit', () => {
    expect(pickRefusal('audio', 'free', 0)).toBe('Uploading audiobooks is part of Pro.')
    expect(pickRefusal('book', 'free', 1)).toBeNull()
    expect(pickRefusal('book', 'free', 2)).toBe(
      'Free includes 2 of your own books. Delete one, or go Pro for up to 25.',
    )
    expect(pickRefusal('book', 'free', 7)).toMatch(/^Free includes 2/)
    expect(pickRefusal('audio', 'pro', 24)).toBeNull()
    expect(pickRefusal('audio', 'pro', 25)).toBe('You have 25 of your own books. Delete one to import another.')
    expect(pickRefusal('mixed', 'free', 9)).toBeNull()
  })
})
