import { describe, expect, it } from 'vitest'
import { parseCreate, parseUpdate } from '~/server/highlights/input'
import { privateBookSlug } from '~/shared/content/book-slug'
import { MAX_NOTE, MAX_PASSAGE } from '~/shared/highlights/limits'

const base = {
  book: 'pride-and-prejudice',
  position: { chapter: 'functions', page: 2 },
  start: 10,
  end: 20,
  text: 'a function',
  color: 'yellow',
}

describe('parseCreate', () => {
  it('accepts the documented body, with or without a note', () => {
    expect(parseCreate(base)).toEqual({ ...base, note: null })
    expect(parseCreate({ ...base, note: null })).toEqual({ ...base, note: null })
    expect(parseCreate({ ...base, note: 'Mine.' })).toEqual({ ...base, note: 'Mine.' })
  })

  it('accepts printed pages and private book slugs', () => {
    const body = {
      ...base,
      book: privateBookSlug('6f1c0000-0000-4000-8000-000000000000'),
      position: { printedPage: 112 },
    }
    expect(parseCreate(body)).toEqual({ ...body, note: null })
  })

  it('cleans the note but never the passage', () => {
    const parsed = parseCreate({ ...base, text: '  a\u0007 b  ', note: '  Café\u0007 one\ntwo\t ' })
    expect(parsed?.text).toBe('  a\u0007 b  ')
    expect(parsed?.note).toBe('Café one\ntwo')
    expect(parseCreate({ ...base, note: '   ' })?.note).toBeNull()
  })

  it('counts characters, not UTF-16 units, against the caps', () => {
    expect(parseCreate({ ...base, text: '😀'.repeat(MAX_PASSAGE) })).not.toBeNull()
    expect(parseCreate({ ...base, text: 'x'.repeat(MAX_PASSAGE + 1) })).toBeNull()
    expect(parseCreate({ ...base, note: '😀'.repeat(MAX_NOTE) })).not.toBeNull()
    expect(parseCreate({ ...base, note: 'x'.repeat(MAX_NOTE + 1) })).toBeNull()
  })

  it('refuses anything else', () => {
    for (const bad of [
      null,
      [],
      'text',
      { ...base, extra: 1 },
      { ...base, prefix: 'trust me' },
      { ...base, book: '../etc' },
      { ...base, book: 'u-not-a-uuid' },
      { ...base, book: 'x'.repeat(201) },
      { ...base, position: { chapter: 'functions', page: 0 } },
      { ...base, position: null },
      { ...base, start: -1 },
      { ...base, start: 1.5 },
      { ...base, start: 20, end: 20 },
      { ...base, start: 21, end: 20 },
      { ...base, end: '20' },
      { ...base, end: 1e12 },
      { ...base, text: '' },
      { ...base, text: 5 },
      { ...base, text: '\ud83d' },
      { ...base, color: 'purple' },
      { ...base, color: undefined },
      { ...base, note: 5 },
    ]) {
      expect(parseCreate(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('parseUpdate', () => {
  it('accepts a colour, a note, both, and a delete', () => {
    expect(parseUpdate({ intent: 'update', color: 'green' })).toEqual({ intent: 'update', color: 'green' })
    expect(parseUpdate({ intent: 'update', note: ' Hi\n ' })).toEqual({ intent: 'update', note: 'Hi' })
    expect(parseUpdate({ intent: 'update', color: 'pink', note: 'x' })).toEqual({
      intent: 'update',
      color: 'pink',
      note: 'x',
    })
    expect(parseUpdate({ intent: 'delete' })).toEqual({ intent: 'delete' })
  })

  it('removes the note for null or an empty string', () => {
    expect(parseUpdate({ intent: 'update', note: null })).toEqual({ intent: 'update', note: null })
    expect(parseUpdate({ intent: 'update', note: '  ' })).toEqual({ intent: 'update', note: null })
  })

  it('refuses anything else', () => {
    for (const bad of [
      null,
      {},
      { intent: 'update' },
      { intent: 'update', color: 'purple' },
      { intent: 'update', note: 7 },
      { intent: 'update', note: 'x'.repeat(MAX_NOTE + 1) },
      { intent: 'update', color: 'green', text: 'changed' },
      { intent: 'delete', id: 'x' },
      { intent: 'remove' },
    ]) {
      expect(parseUpdate(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})
