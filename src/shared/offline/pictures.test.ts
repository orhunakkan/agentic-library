import { describe, expect, it } from 'vitest'
import { pagedFixture } from '../../../tests/fixtures/books'
import type { ChapterBook } from '../content/schema'
import { bookOfUrl, pictureUrls } from './pictures'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

const book = (pages: string[]): ChapterBook => ({
  kind: 'chapter',
  slug: 'essays',
  chapters: [{ id: 'ch_1', slug: 'one', title: 'One', pages }],
})

const img = (src: string) => `<figure><a href="${src}"><img src="${src}" alt="" width="1" height="1"></a></figure>`

describe('pictureUrls', () => {
  it('lists each picture once, in page order, for both kinds of address', () => {
    const content = book([
      `<p>a</p>${img('/images/essays/0123456789ab.png')}`,
      `${img(`/account/books/${ID}/images/2`)}${img('/images/essays/0123456789ab.png')}`,
      img('/images/essays/ba9876543210.jpg'),
    ])
    expect(pictureUrls(content)).toEqual([
      '/images/essays/0123456789ab.png',
      `/account/books/${ID}/images/2`,
      '/images/essays/ba9876543210.jpg',
    ])
  })

  it('leaves out off-site pictures, data: URIs and other addresses', () => {
    const content = book([
      img('https://elsewhere.test/a.png'),
      img('//elsewhere.test/a.png'),
      img('data:image/png;base64,AAAA'),
      img('/covers/essays.svg'),
      img('/images/essays/a.png?x=1'),
      '<p>no pictures</p>',
    ])
    expect(pictureUrls(content)).toEqual([])
  })

  it('reads an escaped attribute as the browser does, and has nothing for a paged book', () => {
    expect(pictureUrls(book([img('/images/essays/a&amp;b.png')]))).toEqual(['/images/essays/a&b.png'])
    expect(pictureUrls(pagedFixture)).toEqual([])
  })
})

describe('bookOfUrl', () => {
  it('names the book of each kind of kept address', () => {
    expect(bookOfUrl('/offline/pride-and-prejudice.json')).toBe('pride-and-prejudice')
    expect(bookOfUrl(`/offline/u-${ID}.json`)).toBe(`u-${ID}`)
    expect(bookOfUrl('/images/pride-and-prejudice/0123456789ab.png')).toBe('pride-and-prejudice')
    expect(bookOfUrl('/covers/pride-and-prejudice.svg')).toBe('pride-and-prejudice')
    expect(bookOfUrl('/covers/pride-and-prejudice-1a2b3c4d.jpg')).toBe('pride-and-prejudice')
    expect(bookOfUrl(`/account/books/${ID}/cover`)).toBe(`u-${ID}`)
    expect(bookOfUrl(`/account/books/${ID}/images/3`)).toBe(`u-${ID}`)
  })

  it('names none for anything else', () => {
    for (const path of [
      '/offline/nav.json',
      '/offline.html',
      '/offline/u-nope.json',
      '/assets/index-abc.js',
      '/_shell.html',
      '/covers/pride-and-prejudice',
      '/account/books/not-a-uuid-at-all-not-a-uuid-at-all-x/cover',
      '/read/essays/one',
      '/images/Bad Slug/x.png',
    ]) {
      expect(bookOfUrl(path), path).toBeNull()
    }
  })
})
