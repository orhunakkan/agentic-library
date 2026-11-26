import type { Page } from '@playwright/test'
import type { LibraryPage } from '../pages'
import { createUser } from '../support/accounts'
import { fakeSpeech, hang } from '../support/fake-speech'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'
import { hydrated } from '../support/settle'

function noonToday(): Date {
  const noon = new Date()
  noon.setHours(12, 0, 0, 0)
  return noon
}

async function freeReader(page: Page): Promise<void> {
  await page.clock.install({ time: noonToday() })
  await createUser(page.request, { signedIn: true })
}

const PRIDE = 'pride-and-prejudice'
const PRIDE_PAGE = `/library/jane-austen/${PRIDE}`

async function openBook(page: Page, libraryPage: LibraryPage): Promise<void> {
  await libraryPage.goto()
  await page
    .getByRole('main')
    .getByRole('link', { name: /Pride and Prejudice/ })
    .first()
    .click()
  await expect(page).toHaveURL(PRIDE_PAGE)
  await page.getByRole('link', { name: 'Start reading' }).click()
  await expect(page).toHaveURL(new RegExp(`/read/${PRIDE}/chapter-1(/1)?$`))
  await hydrated(page)
}

test.describe('Reading stats', () => {
  test.use({ reducedMotion: 'reduce' })

  test('time read counts toward the goal and the streak, on the Stats page and the library card', async ({
    page,
    libraryPage,
    readerPage,
    statsPage,
  }) => {
    await freeReader(page)
    await openBook(page, libraryPage)
    for (let turn = 1; turn <= 6; turn++) {
      await readerPage.turnPage()
      await page.clock.runFor(61_000)
    }

    await libraryPage.goto()
    await statsPage.openFromNav()
    await expect(statsPage.heading).toBeVisible()
    await expect(statsPage.today).toHaveText('6 of 15 minutes today')
    await expect(statsPage.streak).toHaveText('No streak yet. Meet your goal today to start one.')
    await expect(statsPage.days).toHaveCount(7)
    await expect(statsPage.days.last()).toContainText('6 minutes, goal not met')
    await expectAccessible(page)
    await expectNoSideways(page)

    await statsPage.setGoal('5 minutes')
    await expect(statsPage.goalSaved).toHaveText('Saved. Your goal is 5 minutes a day from today.')
    await expect(statsPage.today).toHaveText('6 minutes today · goal met')
    await expect(statsPage.streak).toHaveText('1-day streak')
    await expect(statsPage.best).toHaveText('Best: 1 day')
    await expect(statsPage.days.last()).toContainText('6 minutes, goal met')
    await expect(statsPage.goal).toHaveValue('5')
    await expectAccessible(page)

    await libraryPage.goto()
    await expect(libraryPage.readingCard.getByTestId('library-stats-today')).toHaveText('Today: 6 min · goal met')
    await expect(libraryPage.readingCard.getByTestId('library-stats-streak')).toHaveText('1-day streak')
    await expectAccessible(page)
    await libraryPage.readingCard.click()
    await expect(statsPage.heading).toBeVisible()
  })

  test('reaching a book’s last page marks it finished, and Not finished takes the mark off', async ({
    page,
    libraryPage,
    statsPage,
  }) => {
    await freeReader(page)
    await statsPage.goto()
    await expect(statsPage.empty).toBeVisible()
    await expect(statsPage.finishedCount).toHaveText('No books finished this year yet.')
    await expectAccessible(page)

    await openBook(page, libraryPage)
    await page.goto(`/read/${PRIDE}/chapter-61/2`)
    await expect(page.getByText('End of book').first()).toBeVisible()
    await expect(page.getByTestId('toast')).toHaveText('Finished Pride and Prejudice. It’s in your reading stats.')

    await statsPage.goto()
    await expect(statsPage.finishedCount).toHaveText('1 book finished this year')
    await expect(statsPage.finishedBooks).toHaveCount(1)
    await expect(statsPage.finishedBooks.getByRole('link', { name: 'Pride and Prejudice' })).toHaveAttribute(
      'href',
      PRIDE_PAGE,
    )
    await expect(statsPage.finishedBooks).toContainText('Finished ')
    await expectAccessible(page)
    await expectNoSideways(page)

    await statsPage.unfinish('Pride and Prejudice')
    await expect(statsPage.finishedStatus).toHaveText('Pride and Prejudice is no longer marked finished.')
    await expect(statsPage.finishedCount).toHaveText('No books finished this year yet.')
    await expect(statsPage.finishedBooks).toHaveCount(0)
    await expectAccessible(page)
  })

  test('read aloud reaching the book’s end, in the dock while browsing, marks it finished', async ({
    page,
    libraryPage,
    readAloud,
    statsPage,
  }) => {
    await fakeSpeech(page)
    await freeReader(page)
    await openBook(page, libraryPage)
    await page.goto(`/read/${PRIDE}/chapter-61`)
    await hang(page)
    await readAloud.start()
    await page.getByRole('link', { name: 'Pride and Prejudice' }).first().click()
    await expect(page).toHaveURL(PRIDE_PAGE)
    await hang(page, false)
    await readAloud.dockButton('Next sentence').click()
    const toast = page.getByTestId('toast')
    const finished = 'Finished Pride and Prejudice. It’s in your reading stats.'
    for (let i = 0; i < 400 && (await toast.textContent()) !== finished; i++) await page.clock.runFor(500)
    await expect(toast).toHaveText(finished)

    await statsPage.goto()
    await expect(statsPage.finishedCount).toHaveText('1 book finished this year')
  })
})
