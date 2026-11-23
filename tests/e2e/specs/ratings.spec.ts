import { signedInAt } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'
import { importViaApi } from '../support/imports'

const PROPHET = '/library/poetry-of-the-spirit/the-prophet'

test.describe('Your rating', () => {
  test('rate a catalogue book, see it after a reload, clear it, and rate an imported book', async ({
    page,
    bookPage,
    baseURL,
  }) => {
    await page.goto(PROPHET)
    await expect(bookPage.heading('The Prophet')).toBeVisible()
    await expect(bookPage.rating.group).toHaveCount(0)

    await signedInAt(page, PROPHET)
    const { rating } = bookPage
    await expect(rating.group).toBeVisible()
    await expect(rating.value).toHaveText('Not rated yet')
    await expect(rating.clearButton).toHaveCount(0)

    expect((await rating.rate(4)).status()).toBe(200)
    await expect(rating.value).toHaveText('4 out of 5')
    await expect(rating.star(4)).toBeChecked()
    await expectAccessible(page)
    await expectNoSideways(page)

    await page.reload()
    await expect(rating.star(4)).toBeChecked()
    await expect(rating.value).toHaveText('4 out of 5')

    expect((await rating.clear()).status()).toBe(200)
    await expect(rating.value).toHaveText('Not rated yet')
    await expect(rating.clearButton).toHaveCount(0)
    await expect(rating.star(1)).toBeFocused()
    await page.reload()
    await expect(rating.value).toHaveText('Not rated yet')

    const book = await importViaApi(page.request, baseURL ?? '', {
      title: 'Rated Notes',
      chapters: [{ title: 'One', text: 'A private book to rate.' }],
    })
    await bookPage.gotoImported(book.id)
    await expect(rating.value).toHaveText('Not rated yet')
    expect((await rating.rate(2)).status()).toBe(200)
    await expect(rating.value).toHaveText('2 out of 5')
    await page.reload()
    await expect(rating.star(2)).toBeChecked()
    await expect(rating.value).toHaveText('2 out of 5')
    await expectAccessible(page)
    await expectNoSideways(page)
  })

  test('the arrow keys choose, and a refused change goes back and says why', async ({ page, bookPage, isMobile }) => {
    test.skip(isMobile, 'A keyboard journey, on desktop.')
    await signedInAt(page, PROPHET)
    const { rating } = bookPage
    let answers = 0
    page.on('response', (r) => {
      if (r.url().endsWith('/account/ratings')) answers++
    })

    await bookPage.removeButton.focus()
    await page.keyboard.press('Tab')
    await expect(rating.star(1)).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(rating.value).toHaveText('3 out of 5')
    await expect.poll(() => answers).toBe(2)
    await page.reload()
    await expect(rating.star(3)).toBeChecked()

    await page.route('**/account/ratings', (route) => route.fulfill({ status: 500, json: { error: 'failed' } }), {
      times: 1,
    })
    await rating.star(3).focus()
    const refused = rating.answered()
    await page.keyboard.press('ArrowLeft')
    expect((await refused).status()).toBe(500)
    await expect(rating.error).toHaveText('Couldn’t save your rating. Try again.')
    await expect(rating.value).toHaveText('3 out of 5')
    await expect(rating.star(3)).toBeChecked()
  })
})
