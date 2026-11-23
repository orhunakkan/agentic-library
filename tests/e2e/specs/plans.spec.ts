import { AccountPage, RunDialog, UsersPage } from '../pages'
import { createUser, saveKey } from '../support/accounts'
import { expect, expectAccessible, test } from '../support/fixtures'
import { FIXTURE, importViaApi } from '../support/imports'

const PAGE = '/read/pride-and-prejudice/chapter-6/3'

test.describe('Free and Pro', () => {
  test('a Free reader sees Ask is part of Pro, until an admin gives them Pro', async ({
    page,
    readerPage,
    importPage,
    browser,
    baseURL,
  }) => {
    const reader = await createUser(page.request, { signedIn: true, plan: 'free' })
    await page.goto(PAGE)
    const ask = await readerPage.ask.open()
    await expect(ask.getByText('Ask the book is part of Pro.')).toBeVisible()
    await expect(ask.getByRole('link', { name: 'See Pro' })).toHaveAttribute('href', '/account/plan')
    await expect(ask.getByRole('link', { name: 'Add an API key' })).toHaveCount(0)
    await expect(readerPage.ask.questionBox).toHaveCount(0)
    await expectAccessible(page)
    await ask.getByRole('button', { name: 'Close Ask this book' }).click()
    await expect(readerPage.ask.panel).toBeHidden()

    await page.goto('/read/fixture-code-book/values-and-names/2')
    const run = new RunDialog(page)
    await run.openFrom(run.openButtons('JavaScript'))
    await expect(run.proNotice).toContainText('Running code is part of Pro.')
    await expect(run.proNotice.getByRole('link', { name: 'See Pro' })).toHaveAttribute('href', '/account/plan')
    await expect(run.readOnlyCode).toContainText('console.log(ten * ten);')
    await expect(run.editor).toHaveCount(0)
    await expect(run.runButton).toHaveCount(0)
    await expectAccessible(page)
    await run.close()

    const account = new AccountPage(page)
    await account.goto()
    const plan = page.getByRole('region', { name: 'Plan' })
    await expect(plan.getByTestId('plan-line')).toHaveText('You’re on Free.')
    await expect(plan).toContainText('Your books: 0 of 2')
    await expect(plan).toContainText('Highlights and notes: 0 of 50')
    await expect(plan).not.toContainText('Pride and Prejudice')
    await expect(plan.getByRole('listitem')).toContainText(['Ask the book, with your own Anthropic key'])
    await expectAccessible(page)

    for (const title of ['First', 'Second']) {
      await importViaApi(page.request, baseURL ?? '', { title, chapters: [{ title: 'One', text: 'Words.' }] })
    }
    await importPage.goto()
    await importPage.picker.setInputFiles(FIXTURE.markdown)
    await expect(page.getByTestId('import-pick-error')).toContainText(
      'Free includes 2 of your own books. Delete one, or go Pro for up to 25.',
    )
    await expectAccessible(page)

    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      const adminPage = await other.newPage()
      await createUser(adminPage.request, { role: 'admin', signedIn: true })
      const usersPage = new UsersPage(adminPage)
      await usersPage.goto()
      await expect(usersPage.heading).toBeVisible()
      await usersPage.act(reader.username, 'Give Pro…')
      const confirm = adminPage.getByRole('dialog', { name: `Give ${reader.username} Pro?` })
      await expect(confirm).toContainText('They get every Pro feature until you take it back.')
      await expectAccessible(adminPage)
      await confirm.getByRole('button', { name: 'Give Pro' }).click()
      await expect(usersPage.status).toHaveText(`${reader.username} is on Pro now.`)
    } finally {
      await other.close()
    }

    await saveKey(page)
    await page.goto(PAGE)
    const askPro = await readerPage.ask.open()
    await expect(readerPage.ask.questionBox).toBeVisible()
    await expect(askPro.getByText('Ask the book is part of Pro.')).toHaveCount(0)
    await account.goto()
    await expect(plan.getByTestId('plan-line')).toHaveText('You’re on Pro, given by an admin.')
    await expect(plan).toContainText('Your books: 2 of 25')
    await expect(plan).not.toContainText('Highlights and notes')
  })
})
