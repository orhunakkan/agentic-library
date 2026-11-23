import type { Page } from '@playwright/test'
import { isWide, press } from '../pages'
import { createUser, saveKey, validKey } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'

const PAGE = '/read/pride-and-prejudice/chapter-6/3'
const EXPLAIN = 'Explain like I’m new'.replace('’', "'")
const WHOS_WHO = "Who's who so far"

async function onPromptsPage(page: Page) {
  const user = await createUser(page.request, { signedIn: true })
  await saveKey(page, validKey('0000'))
  if (isWide(page)) {
    await page.goto('/account')
    await page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Prompts' }).click()
  } else {
    await page.goto('/library')
    await page.getByLabel(`Account menu, signed in as ${user.username}`).filter({ visible: true }).click()
    await page.getByRole('link', { name: 'Prompts' }).filter({ visible: true }).click()
  }
  await page.waitForURL('**/account/prompts')
  return user
}

test.describe('Your prompts', () => {
  test('make two prompts, reorder them, and run each from the Ask panel', async ({ page, promptsPage, readerPage }) => {
    await onPromptsPage(page)
    await expect(promptsPage.title).toBeVisible()
    await expect(promptsPage.empty).toBeVisible()
    await expect(promptsPage.starters).toHaveCount(4)
    await expect(promptsPage.count).toHaveText('0 of 20 prompts')

    await promptsPage.useStarter(EXPLAIN)
    await expect(promptsPage.name).toHaveValue(EXPLAIN)
    await expect(promptsPage.name).toBeFocused()
    await expect(page.getByLabel(/^A passage I select/)).toBeChecked()
    await expect(promptsPage.instruction).toHaveValue(/^Explain this passage as if I'm completely new/)
    await promptsPage.save()
    await expect(promptsPage.status).toHaveText(`Saved “${EXPLAIN}”.`)
    await expect(promptsPage.count).toHaveText('1 of 20 prompts')
    await expect(promptsPage.empty).toHaveCount(0)

    await promptsPage.fill({
      name: WHOS_WHO,
      on: 'pages',
      instruction: 'List the people who have come up so far.\nOne line each.',
    })
    await promptsPage.save()
    await expect(promptsPage.card(WHOS_WHO).getByTestId('prompt-applies-to')).toHaveText('On the pages you’ve read')
    expect(await promptsPage.names()).toEqual([EXPLAIN, WHOS_WHO])
    await expect(page.getByRole('button', { name: `Move “${EXPLAIN}” up` })).toBeDisabled()

    await promptsPage.move(WHOS_WHO, 'up')
    await expect(promptsPage.status).toHaveText(`Moved “${WHOS_WHO}” up.`)
    expect(await promptsPage.names()).toEqual([WHOS_WHO, EXPLAIN])
    await expectAccessible(page)
    await expectNoSideways(page)

    await page.goto(PAGE)
    const ask = await readerPage.ask.open()
    await expect(ask.getByTestId('ask-prompts-hint')).toHaveCount(0)
    const menu = await readerPage.ask.openPrompts()
    await expect(menu.getByRole('menuitem')).toHaveText([WHOS_WHO, 'Manage your prompts'])
    await expect(menu.getByText('For the pages you’ve read')).toBeVisible()
    await expectAccessible(page)
    await menu.getByRole('menuitem', { name: WHOS_WHO }).click()
    await expect(ask.getByTestId('ask-question')).toHaveText(`You asked: ${WHOS_WHO}`)
    await expect(ask.getByText(/Prompt: List the people who have come up so far\./)).toBeVisible()
    await expect(ask.getByRole('link', { name: 'Source: Ch. 6 · p. 3' })).toBeVisible()

    if (!isWide(page)) await ask.getByRole('button', { name: 'Close Ask this book' }).click()
    await page
      .locator('#reader-content p')
      .first()
      .evaluate((p) => document.getSelection()?.selectAllChildren(p))
    await press(page, readerPage.button('Ask about this'))
    await expect(ask.getByText('Asking about')).toBeVisible()
    const passageMenu = await readerPage.ask.openPrompts()
    await expect(passageMenu.getByText('For this passage')).toBeVisible()
    await expect(passageMenu.getByRole('menuitem')).toHaveText([EXPLAIN, 'Manage your prompts'])
    await passageMenu.getByRole('menuitem', { name: EXPLAIN }).click()
    await expect(
      ask.getByText(/the passage you selected\. Prompt: Explain this passage as if I'm completel\./),
    ).toBeVisible()
    await expect(ask.getByText('Asking about')).toHaveCount(0)
  })

  test('edit to a name already taken, rename, and delete both', async ({ page, promptsPage }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The page’s second journey; one layout is enough.')
    await onPromptsPage(page)
    for (const name of ['Recap', 'Characters']) {
      await promptsPage.fill({ name, instruction: `${name}, please.` })
      await promptsPage.save()
    }

    await promptsPage.edit('Characters')
    await expect(promptsPage.name).toBeFocused()
    await expect(page.getByTestId('prompts-count')).toBeVisible()
    await expect(page.getByRole('region', { name: 'New prompt' })).toHaveCount(0)
    await promptsPage.fill({ name: 'recap' })
    await promptsPage.save()
    await expect(promptsPage.error).toHaveText('You already have a prompt called “recap”. Pick another name.')

    await promptsPage.fill({ name: 'Who is who', on: 'passage' })
    await promptsPage.save()
    await expect(promptsPage.status).toHaveText('Saved “Who is who”.')
    await expect(promptsPage.card('Who is who').getByTestId('prompt-applies-to')).toHaveText('On a passage you select')
    await expect(promptsPage.card('Who is who').getByRole('button', { name: 'Edit' })).toBeFocused()

    await promptsPage.delete('Recap')
    await expect(promptsPage.status).toHaveText('Deleted “Recap”.')
    await promptsPage.delete('Who is who')
    await expect(promptsPage.empty).toBeVisible()
    await expect(promptsPage.count).toHaveText('0 of 20 prompts')
  })

  test('a prompt deleted on another device: the panel says so, without Retry, and its menu updates', async ({
    page,
    readerPage,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The wiring of one refusal; one layout is enough.')
    await createUser(page.request, { signedIn: true })
    await saveKey(page, validKey('0000'))
    const headers = { origin: new URL(String(testInfo.project.use.baseURL)).origin }
    const saved = await page.request.post('/account/prompts/new', {
      data: { name: WHOS_WHO, appliesTo: 'pages', instruction: 'List them.' },
      headers,
    })
    const { prompt } = (await saved.json()) as { prompt: { id: string } }
    await page.goto(PAGE)
    const ask = await readerPage.ask.open()
    const menu = await readerPage.ask.openPrompts()
    await page.request.post(`/account/prompts/${prompt.id}`, { data: { intent: 'delete' }, headers })
    await menu.getByRole('menuitem', { name: WHOS_WHO }).click()
    await expect(ask.getByTestId('ask-error')).toHaveText(
      'That prompt isn’t there any more. It may have been deleted on another device.',
    )
    await expect(ask.getByRole('button', { name: 'Retry' })).toHaveCount(0)
    await expect(readerPage.ask.promptsMenu).toHaveCount(0)
  })
})
