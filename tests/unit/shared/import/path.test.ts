import { describe, expect, it } from 'vitest'
import { decodePath, dirname, joinPath } from '~/shared/import/path'

describe('dirname', () => {
  it('gives the folder of an archive path, or nothing at the root', () => {
    expect(dirname('OEBPS/text/ch1.xhtml')).toBe('OEBPS/text')
    expect(dirname('content.opf')).toBe('')
  })
})

describe('joinPath', () => {
  it('joins with "/" and resolves "." and ".."', () => {
    expect(joinPath('OEBPS/text', '../images/a.png')).toBe('OEBPS/images/a.png')
    expect(joinPath('OEBPS', './text/', 'ch1.xhtml')).toBe('OEBPS/text/ch1.xhtml')
    expect(joinPath('a//b', '')).toBe('a/b')
  })

  it('drops ".." above the root, so a path can never climb out of the archive', () => {
    expect(joinPath('OEBPS', '../../../etc/passwd')).toBe('etc/passwd')
    expect(joinPath('/abs', 'x')).toBe('abs/x')
  })
})

describe('decodePath', () => {
  it('decodes a percent-encoded href', () => {
    expect(decodePath('text/chapter%201.md')).toBe('text/chapter 1.md')
  })

  it('keeps an href as written when it is not valid percent-encoding', () => {
    expect(decodePath('100%.md')).toBe('100%.md')
  })
})
