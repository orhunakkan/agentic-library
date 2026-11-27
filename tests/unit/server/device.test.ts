import { describe, expect, it } from 'vitest'
import { describeDevice } from '~/server/device'

describe('describeDevice', () => {
  it('names the browser and system', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome on Windows')
    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iPhone')
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 15.0; rv:143.0) Gecko/20100101 Firefox/143.0')).toBe(
      'Firefox on macOS',
    )
    expect(describeDevice('curl/8.0')).toBe('Unknown device')
    expect(describeDevice(null)).toBe('Unknown device')
  })
})
