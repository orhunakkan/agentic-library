import type { BookPage } from '../pages'
import { expect, expectAccessible, test } from '../support/fixtures'

async function startOnLove(bookPage: BookPage) {
  await bookPage.goto('poetry-of-the-spirit', 'the-prophet', '?tab=audio')
  await bookPage.audio.playEpisode('On Love').click()
  await expect(bookPage.audio.dock).toBeVisible()
}

test.describe('Audio player', () => {
  test.beforeEach(async ({ bookPage }) => startOnLove(bookPage))

  test('expanded player: speed is remembered, the player survives navigation, queue scoped to the book, go to page, minimize', async ({
    page,
    audioPlayer,
  }) => {
    await audioPlayer.openButton.click()
    const sheet = audioPlayer.sheet
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('Chapter 2', { exact: true })).toBeVisible()
    await expectAccessible(page)
    await sheet.getByRole('button', { name: 'Speed 1.0x' }).click()
    await expect(sheet.getByRole('button', { name: 'Speed 1.25x' })).toBeVisible()

    await page.reload()
    await audioPlayer.playEpisode('On Love').click()
    await page.getByRole('link', { name: 'Library', exact: true }).first().click()
    await expect(page).toHaveURL('/library')
    await expect(audioPlayer.dock).toContainText('On Love')
    await expect(audioPlayer.dock).toContainText('Chapter 2')

    await audioPlayer.openButton.click()
    await expect(sheet.getByRole('button', { name: 'Speed 1.25x' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Previous' }).click()
    await expect(sheet.getByRole('button', { name: 'The Coming of the Ship' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await sheet.getByRole('button', { name: 'Next' }).click()
    await expect(sheet.getByRole('button', { name: 'On Love' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await audioPlayer.openButton.click()
    await audioPlayer.sheet.getByRole('button', { name: 'Go to page' }).click()
    await expect(page).toHaveURL('/read/the-prophet/on-love')
    await expect(audioPlayer.dock).toBeVisible()
  })

  test('the mini player skips forward and back 15 seconds, and Close removes it', async ({ audioPlayer }) => {
    const dock = audioPlayer.dock
    const position = async () => {
      const [mm = '0', ss = '0'] =
        ((await dock.getByText(/\d+:\d\d \/ /).textContent()) ?? '').split(' / ')[0]?.split(':') ?? []
      return Number(mm) * 60 + Number(ss)
    }
    const before = await position()
    await dock.getByRole('button', { name: 'Forward 15 seconds' }).click()
    await expect.poll(position).toBeGreaterThanOrEqual(before + 14)
    await dock.getByRole('button', { name: 'Back 15 seconds' }).click()
    await expect.poll(position).toBeLessThan(before + 14)

    await audioPlayer.closeButton.click()
    await expect(audioPlayer.dock).toHaveCount(0)
  })
})

test.describe('Audio player with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test.beforeEach(async ({ bookPage }) => startOnLove(bookPage))

  test('honours the reduce-motion setting: the player opens without sliding', async ({ page }) => {
    const tops = await page.evaluate(async () => {
      document.querySelector<HTMLButtonElement>('button[class*="flex-1"] .sr-only')?.closest('button')?.click()
      const seen: number[] = []
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => requestAnimationFrame(r))
        const top = document.querySelector('[role="dialog"][aria-label="Now playing"]')?.getBoundingClientRect().top
        if (top !== undefined) seen.push(Math.round(top))
      }
      return { seen, height: window.innerHeight }
    })
    expect(tops.seen.at(-1)).toBe(0)
    expect(
      tops.seen.filter((top) => top > 0 && top < tops.height),
      `positions ${tops.seen.join(', ')}`,
    ).toEqual([])
  })
})

test.describe('Audio player sleep timer', () => {
  test('counts 15 minutes of playing, then fades out over 10 seconds and pauses', async ({
    page,
    audioPlayer,
    bookPage,
  }) => {
    await page.clock.install()
    await startOnLove(bookPage)
    const dock = audioPlayer.dock
    await expect(dock.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await audioPlayer.openButton.click()
    const sheet = audioPlayer.sheet
    await sheet.getByRole('button', { name: 'Sleep timer' }).click()
    const menu = page.getByRole('menu', { name: 'Sleep timer' })
    await expect(menu.getByRole('menuitemradio')).toHaveText([
      'Off',
      '15 min',
      '30 min',
      '45 min',
      '60 min',
      'End of episode',
    ])
    await menu.getByRole('menuitemradio', { name: '15 min' }).click()
    await expect(sheet.getByRole('button', { name: 'Sleep · 15 min' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Minimize' }).click()
    await expect(dock).toContainText('Sleep · 15 min')

    for (let minute = 0; minute < 15; minute++) await page.clock.runFor(60_000)
    await expect(page.getByRole('status').filter({ hasText: 'Sleep timer ended' })).toBeVisible()
    const volume = () => page.getByTestId('audio-element').evaluate((a: HTMLAudioElement) => a.volume)
    await page.clock.runFor(5000)
    await expect.poll(volume).toBeLessThan(0.75)
    await expect(dock.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await page.clock.runFor(6000)
    await expect(dock.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    expect(await volume()).toBe(1)
    await expect(dock).not.toContainText('Sleep ·')
  })
})
