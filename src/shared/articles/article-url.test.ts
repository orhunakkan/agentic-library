import { describe, expect, it } from 'vitest'
import { canonicalArticleUrl, isTestHost, parseArticleUrl } from './article-url'

const ok = (input: string, options = {}) => {
  const result = parseArticleUrl(input, options)
  if (!result.ok) throw new Error(`refused ${input}: ${result.reason}`)
  return result.url.href
}
const reason = (input: string, options = {}) => {
  const result = parseArticleUrl(input, options)
  return result.ok ? 'ok' : result.reason
}

describe('parseArticleUrl', () => {
  it('accepts web addresses', () => {
    expect(ok('https://example.com/a-long-read')).toBe('https://example.com/a-long-read')
    expect(ok('http://example.com/x')).toBe('http://example.com/x')
    expect(ok('  example.com/a?b=1  ')).toBe('https://example.com/a?b=1')
    expect(ok('//example.com/a')).toBe('https://example.com/a')
    expect(ok('https://EXAMPLE.com/Path')).toBe('https://example.com/Path')
    expect(ok('https://bücher.de/x')).toBe('https://xn--bcher-kva.de/x')
    expect(ok('https://example.com:443/x')).toBe('https://example.com/x')
    expect(ok('http://example.com:443/x')).toBe('http://example.com:443/x')
    expect(ok('https://[2606:4700::1111]/x')).toBe('https://[2606:4700::1111]/x')
    expect(ok('https://93.184.216.34/x')).toBe('https://93.184.216.34/x')
    expect(ok('example.com.')).toBe('https://example.com./')
  })

  it('refuses each kind of address, with its reason', () => {
    expect(reason('')).toBe('empty')
    expect(reason('   ')).toBe('empty')
    expect(reason(`https://example.com/${'a'.repeat(1981)}`)).toBe('too_long')
    expect(reason('not a url')).toBe('not_url')
    expect(reason('https://')).toBe('not_url')
    expect(reason('ftp://example.com/x')).toBe('scheme')
    expect(reason('file:///etc/passwd')).toBe('scheme')
    expect(reason('javascript:alert(1)')).toBe('scheme')
    expect(reason('data:text/html,<b>hi</b>')).toBe('scheme')
    expect(reason('https://user:pass@example.com/')).toBe('credentials')
    expect(reason('https://user@example.com/')).toBe('credentials')
    expect(reason('https://example.com:8080/')).toBe('port')
    expect(reason('localhost:3000')).toBe('port')
    for (const host of ['localhost', 'foo.localhost', 'printer.local', 'db.internal', 'nas.home.arpa', 'intranet'])
      expect(reason(`http://${host}/x`), host).toBe('private_host')
    for (const host of [
      '127.0.0.1',
      '[::1]',
      '10.1.2.3',
      '0x7f000001',
      '2130706433',
      '017700000001',
      '0x7f.1',
      '169.254.169.254',
      '[::ffff:10.0.0.1]',
      '[::ffff:127.0.0.1]',
    ])
      expect(reason(`http://${host}/x`), host).toBe('private_host')
    expect(reason('dev.agenticlibrary.app/x')).toBe('own_site')
    expect(reason('https://agenticlibrary.app/library')).toBe('own_site')
    expect(reason('https://folio.example/x', { ownHosts: ['folio.example'] })).toBe('own_site')
  })

  it('lets the test hosts through, to any address and port', () => {
    const testHosts = ['127.0.0.1:4555']
    expect(ok('http://127.0.0.1:4555/article', { testHosts })).toBe('http://127.0.0.1:4555/article')
    expect(reason('http://127.0.0.1:4556/article', { testHosts })).toBe('port')
    expect(reason('http://127.0.0.1/article', { testHosts })).toBe('private_host')
  })
})

describe('isTestHost', () => {
  it('compares the host and the port it connects to', () => {
    expect(isTestHost(new URL('http://a.test/x'), ['a.test:80'])).toBe(true)
    expect(isTestHost(new URL('https://a.test/x'), ['a.test:80'])).toBe(false)
    expect(isTestHost(new URL('https://a.test/x'))).toBe(false)
  })
})

describe('canonicalArticleUrl', () => {
  it('drops the fragment', () =>
    expect(canonicalArticleUrl('https://example.com/a#part-2')).toBe('https://example.com/a'))
  it('drops each tracking parameter and keeps the order of the rest', () => {
    for (const name of [
      'utm_source',
      'utm_medium',
      'UTM_Campaign',
      'fbclid',
      'gclid',
      'dclid',
      'msclkid',
      'mc_cid',
      'mc_eid',
      'igshid',
      'ref_src',
    ])
      expect(canonicalArticleUrl(`https://example.com/a?${name}=x`), name).toBe('https://example.com/a')
    expect(canonicalArticleUrl('https://example.com/a?z=1&utm_source=x&a=2&gclid=3&m=%20b')).toBe(
      'https://example.com/a?z=1&a=2&m=%20b',
    )
  })
  it('keeps an address without a query as it is', () => {
    expect(canonicalArticleUrl(new URL('https://Example.com/a'))).toBe('https://example.com/a')
    expect(canonicalArticleUrl('https://example.com/a?')).toBe('https://example.com/a')
  })
  it('keeps a parameter whose name is not valid encoding', () =>
    expect(canonicalArticleUrl('https://example.com/a?%E0%A4%A=1')).toBe('https://example.com/a?%E0%A4%A=1'))
})
