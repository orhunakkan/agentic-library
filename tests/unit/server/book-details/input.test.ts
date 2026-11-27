import { describe, expect, it } from 'vitest'
import { parseApply, parseDetailsForm, parseLookup } from '~/server/book-details/input'

const form = (fields: Record<string, string | string[] | undefined>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields))
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) data.append(key, v)
  return data
}

const now = new Date('2026-11-05T00:00:00Z')
const details = {
  intent: 'details',
  title: ' Field  Notes ',
  author: 'Ada',
  description: '',
  isbn: '',
  publisher: '',
  year: '',
}

describe('parseDetailsForm', () => {
  it('takes the details, cleaned, with empty fields as null', () => {
    expect(parseDetailsForm(form(details), now)).toEqual({
      intent: 'details',
      title: 'Field Notes',
      author: 'Ada',
      details: { description: null, isbn: null, publisher: null, publishedYear: null },
    })
    const full = {
      ...details,
      description: 'One <b>line</b>.\r\n\r\nTwo.',
      isbn: '0-14-143951-3',
      publisher: ' Me ',
      year: '2027',
    }
    expect(parseDetailsForm(form(full), now)).toMatchObject({
      details: { description: 'One line.\n\nTwo.', isbn: '9780141439518', publisher: 'Me', publishedYear: 2027 },
    })
  })

  it('takes remove-cover on its own', () => {
    expect(parseDetailsForm(form({ intent: 'remove-cover' }), now)).toEqual({ intent: 'remove-cover' })
  })

  it('refuses a bad ISBN, a long description, and anything else malformed', () => {
    expect(parseDetailsForm(form({ ...details, isbn: '9780141439519' }), now)).toEqual({ problem: 'invalid-isbn' })
    expect(parseDetailsForm(form({ ...details, description: 'word '.repeat(801) }), now)).toEqual({
      problem: 'too-long',
    })
    for (const bad of [
      { ...details, title: ' ' },
      { ...details, author: '' },
      { ...details, title: 't'.repeat(301) },
      { ...details, author: 'a'.repeat(201) },
      { ...details, publisher: 'p'.repeat(201) },
      { ...details, year: '2028' },
      { ...details, year: '0' },
      { ...details, year: '19x9' },
      { ...details, title: ['a', 'b'] },
      { ...details, owner: 'someone' },
      { intent: 'delete' },
      {},
    ])
      expect(parseDetailsForm(form(bad), now)).toEqual({ problem: 'invalid' })
    const file = new FormData()
    file.append('intent', new Blob(['x']))
    expect(parseDetailsForm(file, now)).toEqual({ problem: 'invalid' })
  })
})

describe('parseLookup', () => {
  it('searches by a valid ISBN first, else by title and author', () => {
    expect(parseLookup({ title: 'Pride', author: 'Austen', isbn: '978-0-14-143951-8' })).toEqual({
      by: 'isbn',
      isbn: '9780141439518',
    })
    expect(parseLookup({ title: ' Pride  and Prejudice ', author: 'Austen', isbn: '123' })).toEqual({
      by: 'title',
      title: 'Pride and Prejudice',
      author: 'Austen',
    })
    expect(parseLookup({ title: 'Pride' })).toEqual({ by: 'title', title: 'Pride', author: '' })
  })

  it('refuses an empty query, other fields, wrong types and long text', () => {
    for (const bad of [
      {},
      { title: ' ', isbn: '' },
      { title: 'x', book: 'id' },
      { title: 3 },
      { title: 'x', author: ['y'] },
      { title: 't'.repeat(301) },
      { title: 'x', author: 'a'.repeat(201) },
      'title',
      null,
      [],
    ])
      expect(parseLookup(bad)).toBeNull()
  })
})

describe('parseApply', () => {
  it('takes a work id, a cover id or null, and the two choices', () => {
    const body = { work: 'OL66554W', coverId: 14348537, useCover: true, useDescription: false }
    expect(parseApply(body)).toEqual(body)
    expect(parseApply({ ...body, coverId: null })).toEqual({ ...body, coverId: null })
    expect(parseApply({ work: 'OL1W', useCover: false, useDescription: true })).toMatchObject({ coverId: null })
  })

  it('refuses a work id that isn’t OL…W, a bad cover id and anything else', () => {
    const body = { work: 'OL66554W', coverId: 1, useCover: true, useDescription: true }
    for (const bad of [
      { ...body, work: 'OL66554M' },
      { ...body, work: '/works/OL66554W' },
      { ...body, work: 'OL1234567890123W' },
      { ...body, coverId: 0 },
      { ...body, coverId: 1.5 },
      { ...body, coverId: '1' },
      { ...body, coverId: Number.MAX_SAFE_INTEGER + 1 },
      { ...body, useCover: 'yes' },
      { ...body, description: 'x' },
      null,
    ])
      expect(parseApply(bad)).toBeNull()
  })
})
