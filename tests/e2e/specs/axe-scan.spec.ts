import { expect, expectAccessible, test } from '../support/fixtures'

test('a still element with low contrast is still reported', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const faint = document.createElement('p')
    faint.textContent = 'Too faint to read'
    Object.assign(faint.style, { color: '#bbbbbb', background: '#ffffff', position: 'fixed', top: '0', left: '0' })
    document.body.append(faint)
  })
  await expect(expectAccessible(page)).rejects.toThrow(/color-contrast/)
})

test('a fade that starts during the scan is scanned again once settled, not reported', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const bubble = document.createElement('div')
    bubble.textContent = 'Link copied'
    bubble.className = 'rounded-full bg-ink px-4 py-2 text-sm text-page'
    Object.assign(bubble.style, { position: 'fixed', bottom: '96px', left: '40%' })
    document.body.append(bubble)
    let injected: unknown
    Object.defineProperty(window, 'axe', {
      configurable: true,
      get: () => injected,
      set: (value) => {
        injected = value
        bubble.animate([{ opacity: 0.4 }, { opacity: 0 }], { duration: 1500 }).finished.then(() => bubble.remove())
      },
    })
  })
  await expectAccessible(page)
})
