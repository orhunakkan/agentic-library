import { createUser } from '../support/accounts'
import { fakePaddle } from '../support/fake-paddle'
import { expect, expectAccessible, test } from '../support/fixtures'

test.describe('Buying Pro', () => {
  test('a Free reader buys founding yearly, is Pro once Paddle confirms, and opens Manage billing', async ({
    page,
    homePage,
    proPage,
    readerPage,
  }) => {
    await fakePaddle(page)
    await createUser(page.request, { signedIn: true, plan: 'free' })

    await homePage.goto()
    const pricing = page.getByRole('region', { name: 'Free to read, for good. Pro when you want more.' })
    await expect(pricing.getByTestId('founding-band')).toContainText('Founding members: $29 a year')
    await expectAccessible(page)
    await pricing.getByRole('link', { name: 'Go Pro' }).click()
    await expect(page).toHaveURL('/account/plan')
    await expect(proPage.heading).toBeVisible()

    await expect(page.getByRole('radio', { name: 'Yearly' })).toBeChecked()
    await expect(proPage.offer).toHaveText(
      /^\$39 \$29 a year\. Founding member price: yours for as long as you stay subscribed\. \d+ of 100 left\.$/,
    )
    await proPage.choose('Monthly')
    await expect(proPage.offer).toHaveText('$4.99 a month')
    await expect(proPage.buyButton()).toHaveText('Go Pro, $4.99 a month')
    await proPage.choose('Yearly')
    await expect(page.getByRole('main').getByRole('link', { name: 'Refunds' })).toHaveAttribute('href', '/refunds')
    await expectAccessible(page)

    await page.evaluate(() => {
      ;(window as { __paddleClose?: boolean }).__paddleClose = true
    })
    await proPage.buyButton('Go Pro, $29 a year').click()
    await page.waitForFunction(() => (window as { __paddleOpened?: unknown }).__paddleOpened !== undefined)
    await expect(proPage.buyButton('Go Pro, $29 a year')).toBeEnabled()
    await page.evaluate(() => {
      ;(window as { __paddleOpened?: unknown }).__paddleOpened = undefined
      ;(window as { __paddleClose?: boolean }).__paddleClose = false
    })

    await proPage.buyButton('Go Pro, $29 a year').click()
    await expect(page.getByRole('status').filter({ hasText: 'Welcome to Pro.' })).toContainText('Everything is on.')
    const opened = await page.evaluate(() => (window as { __paddleOpened?: Record<string, unknown> }).__paddleOpened)
    expect(opened).toMatchObject({ transactionId: expect.stringMatching(/^txn_/), environment: 'sandbox' })
    await expect(page.getByRole('link', { name: 'Back to reading' })).toBeVisible()
    await expect(proPage.planLine).toHaveText('You’re on Pro, founding yearly.')

    await page.goto('/read/pride-and-prejudice/chapter-6/3')
    const ask = await readerPage.ask.open()
    await expect(ask.getByRole('link', { name: 'Add an API key' })).toBeVisible()
    await expect(ask.getByText('Ask the book is part of Pro.')).toHaveCount(0)
    await ask.getByRole('button', { name: 'Close Ask this book' }).click()

    await proPage.goto()
    await expect(proPage.planStatus).toHaveText(/^Renews on \d{1,2} [A-Z][a-z]{2} \d{4} for \$29\.$/)
    await expectAccessible(page)
    await proPage.manageBilling.click()
    await expect(page).toHaveURL(/\/test-paddle\/portal\/ctm_[a-z0-9]+$/)
    await expect(page.getByRole('heading', { name: 'Paddle customer portal' })).toBeVisible()
  })

  test('a refused checkout, and a Paddle.js that won’t load, say so under the button', async ({
    page,
    proPage,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The copy’s wiring; the device adds nothing.')
    await createUser(page.request, { signedIn: true, plan: 'free' })
    await proPage.goto()
    await page.route(
      '**/account/plan/checkout',
      (route) => route.fulfill({ status: 409, json: { error: 'subscribed' } }),
      {
        times: 1,
      },
    )
    await proPage.buyButton().click()
    await expect(page.getByRole('alert')).toHaveText('You already have Pro.')
    await page.route('https://cdn.paddle.com/**', (route) => route.abort())
    await proPage.buyButton().click()
    await expect(page.getByRole('alert')).toHaveText('Couldn’t open the checkout. Try again in a moment.')
    await expect(proPage.buyButton()).toBeEnabled()
  })
})
