import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { signedInAt } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'

const AUDIO = join(import.meta.dirname, '../../fixtures/audio')
const MP3S = ['chapter-1.mp3', 'chapter-2.mp3', 'chapter-3.mp3'].map((f) => join(AUDIO, f))
const M4B = join(AUDIO, 'three-chapters.m4b')
const DRM = join(AUDIO, 'drm.m4b')

const playedTo = (page: Page) =>
  page.getByTestId('audio-element').evaluate((audio) => (audio as HTMLAudioElement).currentTime)

test.describe('Importing an audiobook', () => {
  test('MP3s: review and rename, import, the page, Listen, Next, and Continue listening after a reload', async ({
    page,
    importPage,
    audiobookPage,
    audioPlayer,
  }) => {
    await signedInAt(page, '/account/books')
    await expect(
      page.getByText('An audiobook is one M4B file, or all the MP3 files of one audiobook: pick them together.'),
    ).toBeVisible()

    await importPage.pickAudiobook(MP3S)
    const review = importPage.audiobookReview
    await expect(review.getByLabel('Title', { exact: true })).toHaveValue('The Fixture Audiobook')
    await expect(review.getByLabel('Author')).toHaveValue('Ada Fixture')
    await expect(review.getByLabel('Read by')).toHaveValue('Rex Reader')
    await expect(review.getByTestId('audiobook-summary')).toHaveText(/^30 s · 3 chapters · \d+ KB · 3 MP3 files$/)
    await expect(review.getByText('One chapter per file, in track order.')).toBeVisible()
    await expect(review.getByText('From the book’s file')).toBeVisible()
    await expect
      .poll(() =>
        review
          .getByRole('textbox', { name: /^Chapter \d+ title$/ })
          .evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value)),
      )
      .toEqual(['The Arrival', 'The Dinner', 'The Departure'])
    await expectAccessible(page)
    await expectNoSideways(page)

    await review.getByLabel('Chapter 2 title').fill('The Long Dinner')
    await review.getByRole('button', { name: 'Import', exact: true }).click()

    await expect(page).toHaveURL(/\/account\/books\/[0-9a-f-]{36}\?status=imported$/, { timeout: 20_000 })
    await expect(page.getByText('Audiobook imported. It’s on your shelf.')).toBeVisible()
    await expect(audiobookPage.heading).toHaveText('The Fixture Audiobook')
    await expect(page.getByText('Read by Rex Reader')).toBeVisible()
    await expect(audiobookPage.chapter(2, 'The Long Dinner')).toBeVisible()
    await expect(audiobookPage.rating.group).toBeVisible()
    await expect(audiobookPage.rating.value).toHaveText('Not rated yet')
    await expect(page.getByRole('link', { name: 'Start reading' })).toHaveCount(0)
    await expectAccessible(page)
    await expectNoSideways(page)

    await expect(audiobookPage.listen).toHaveText('Listen')
    await audiobookPage.listen.click()
    await expect(audioPlayer.dock).toContainText('The Arrival')
    await expect.poll(() => playedTo(page)).toBeGreaterThan(0)
    await audioPlayer.openSheet()
    await expect(audioPlayer.sheet.getByRole('button', { name: 'Go to page' })).toHaveCount(0)
    await audioPlayer.sheet.getByRole('button', { name: 'Next' }).click()
    await expect(audioPlayer.sheet.getByRole('button', { name: 'The Long Dinner' })).toBeVisible()
    await expect.poll(() => playedTo(page)).toBeGreaterThan(0)
    await page.keyboard.press('Escape')
    await audioPlayer.dockButton('Pause').click()
    await expect
      .poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('listen-pos:u-'))))
      .toContainEqual(expect.stringMatching(/:2$/))

    await page.reload()
    await expect(audiobookPage.listen).toHaveText('Continue listening')
  })

  test('M4B with chapters: its chapters on the page, chapter 3 plays from the list; a DRM file is refused', async ({
    page,
    importPage,
    audiobookPage,
    audioPlayer,
  }) => {
    await signedInAt(page, '/account/books')

    await importPage.picker.setInputFiles(DRM)
    await expect(importPage.alert).toHaveText(
      'This audiobook is copy-protected (DRM), so Folio can’t play it. Folio imports M4B and MP3 files without DRM.',
    )

    await importPage.pickAudiobook([M4B])
    const review = importPage.audiobookReview
    await expect(review.getByText('Chapters from the file.')).toBeVisible()
    await expect(review.getByTestId('audiobook-summary')).toHaveText('9 s · 3 chapters · 36 KB · M4B')
    await review.getByRole('button', { name: 'Import', exact: true }).click()

    await expect(page).toHaveURL(/\?status=imported$/, { timeout: 20_000 })
    await expect(audiobookPage.chapters.getByRole('button')).toHaveCount(3)
    await expect(audiobookPage.chapter(1, 'Opening Credits')).toBeVisible()
    await expect(audiobookPage.chapter(2, 'The Storm')).toBeVisible()
    await audiobookPage.chapter(3, 'The Calm').click()
    await expect(audioPlayer.dock).toContainText('The Calm')
    await expect(audiobookPage.chapter(3, 'The Calm')).toContainText('Playing')
    await expect.poll(() => playedTo(page)).toBeGreaterThanOrEqual(6)
  })
})
