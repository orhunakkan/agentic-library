import type { Page } from '@playwright/test'
import { createUser, signedInAt } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, hydrated, test } from '../support/fixtures'

const LISTING = '/read/fixture-code-book/values-and-names/2'
const ORIGINAL = 'let ten = 10;\nconsole.log(ten * ten);\n// → 100'

/** What code run in the reader could change about Folio in this browser, if it got out of its sandbox. */
const folioState = (page: Page) =>
  page.evaluate(async () => ({
    cookie: document.cookie,
    storage: Object.keys(localStorage).sort(),
    databases: (await indexedDB.databases()).map((d) => d.name).sort(),
  }))

test.describe('Run code', () => {
  test('a plain member runs a JavaScript example, edits and breaks it, resets it, and runs a TypeScript one', async ({
    page,
    runDialog,
  }) => {
    await createUser(page.request, { signedIn: true })
    await page.goto(LISTING)
    await hydrated(page)
    const open = runDialog.openButtons('JavaScript')
    await expect(open).toHaveCount(1)
    await expect(open).toHaveText('Run')
    await expect(page.locator('[data-highlight-root]')).not.toContainText('Run')

    await runDialog.openFrom(open)
    await expect(runDialog.title).toHaveText('JavaScript example')
    await expect(runDialog.editor).toHaveValue(ORIGINAL)
    await expect(runDialog.editor).toBeFocused()
    await expect(runDialog.output).toHaveText('Output appears here.')
    await expect(runDialog.resetButton).toBeDisabled()
    await runDialog.run()
    await expect(runDialog.output).toHaveText('100')
    await expect(runDialog.status).toHaveText(/^Finished in \d+ ms\.$/)

    await runDialog.write('let ten = 10;\nconsole.log(ten + 1)')
    await runDialog.run({ keys: true })
    await expect(runDialog.output).toHaveText('11')
    await runDialog.write('let ten = 10;\nten()')
    await runDialog.run()
    await expect(runDialog.status).toHaveText('Stopped by an error on line 2.')
    await expect(runDialog.output).toContainText('TypeError: ten is not a function')
    await expectAccessible(page)
    await expectNoSideways(page)

    await runDialog.close()
    await expect(open).toBeFocused()
    await runDialog.openFrom(open)
    await expect(runDialog.editor).toHaveValue('let ten = 10;\nten()')
    await runDialog.resetButton.click()
    await expect(runDialog.editor).toHaveValue(ORIGINAL)
    await expect(runDialog.resetButton).toBeDisabled()
    await runDialog.close()
    await expect(open).toBeFocused()

    await page.goto('/read/fixture-code-book/lists-and-tables')
    await hydrated(page)
    await runDialog.openFrom(runDialog.openButtons('TypeScript'))
    await expect(runDialog.title).toHaveText('TypeScript example')
    await expect(runDialog.note).toHaveText(
      'Types aren’t checked here. They’re removed, and the code runs as JavaScript.',
    )
    await runDialog.run()
    await expect(runDialog.output).toHaveText('dark')
    await expectNoSideways(page)
    await runDialog.write('const theme = "dark"\nconst settings = { theme')
    await runDialog.run()
    await expect(runDialog.status).toHaveText('Stopped by an error on line 2.')
    await expect(runDialog.output).toContainText('SyntaxError')
    await runDialog.close()

    await page.goto('/read/fixture-code-book/writing-about-markup')
    await hydrated(page)
    await expect(page.locator('#reader-content pre')).toHaveCount(1)
    await expect(page.getByRole('button', { name: /^Run .* example$/ })).toHaveCount(0)
  })

  test('signed out, the dialog shows the code read-only and asks to sign in', async ({ page, runDialog }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The engines and the sandbox are the same on every layout.')
    await page.goto(LISTING)
    await hydrated(page)
    await runDialog.openFrom(runDialog.openButtons('JavaScript'))
    await expect(runDialog.signedOut).toHaveText('Sign in to run code.')
    await expect(runDialog.dialog.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(LISTING)}`,
    )
    await expect(runDialog.readOnlyCode).toHaveText(ORIGINAL)
    await expect(runDialog.editor).toHaveCount(0)
    await runDialog.close()
  })

  test('Python runs, and says it is getting ready the first time', async ({ page, runDialog }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The engines and the sandbox are the same on every layout.')
    test.setTimeout(90_000)
    await signedInAt(page, '/read/fixture-code-book/other-languages')
    const before = await folioState(page)

    await runDialog.openFrom(runDialog.openButtons('Python'))
    await runDialog.status.evaluate((status) => {
      const seen: string[] = []
      ;(window as unknown as { statuses: string[] }).statuses = seen
      new MutationObserver(() => seen.push(status.textContent ?? '')).observe(status, {
        childList: true,
        characterData: true,
        subtree: true,
      })
    })
    await runDialog.run()
    await expect(runDialog.output).toHaveText('10', { timeout: 60_000 })
    expect(await page.evaluate(() => (window as unknown as { statuses: string[] }).statuses)).toContain(
      'Getting Python ready. The first time downloads about 12 MB.',
    )
    await runDialog.close()
    expect(await folioState(page)).toEqual(before)
  })

  test('SQL that couldn’t get ready runs once it can', async ({ page, runDialog }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The engines and the sandbox are the same on every layout.')
    await signedInAt(page, '/read/fixture-code-book/other-languages')
    const before = await folioState(page)

    await test.step('a failed download of SQLite says so', async () => {
      await page.route('**/run-code/sqlite-*/sqlite3.mjs', (route) => route.abort())
      await runDialog.openFrom(runDialog.openButtons('SQL'))
      await runDialog.run()
      await expect(runDialog.status).toHaveText('Couldn’t get SQLite ready. Check your connection and try again.', {
        timeout: 30_000,
      })
      await runDialog.close()
      await page.unroute('**/run-code/sqlite-*/sqlite3.mjs')
    })

    await test.step('the next run shows its table and the rows it changed', async () => {
      await runDialog.openFrom(runDialog.openButtons('SQL'))
      await runDialog.run()
      const table = runDialog.output.getByRole('table')
      await expect(table.getByRole('row')).toHaveCount(4, { timeout: 30_000 })
      await expect(table.getByRole('columnheader')).toHaveText(['title', 'pages'])
      await expect(table.getByRole('row').nth(1).getByRole('cell')).toHaveText(['Sanditon', '120'])
      await expect(runDialog.output).toContainText('3 rows changed')
      await runDialog.close()
    })
    expect(await folioState(page)).toEqual(before)
  })

  test('code can’t outlast its time or its output limit', async ({ page, runDialog }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The engines and the sandbox are the same on every layout.')
    test.setTimeout(60_000)
    await signedInAt(page, LISTING)
    const before = await folioState(page)
    const open = runDialog.openButtons('JavaScript')
    await runDialog.openFrom(open)

    await test.step('a loop that never ends is stopped after 5 seconds', async () => {
      await runDialog.write('while (true) {}')
      await runDialog.run()
      await expect(runDialog.stopButton).toBeVisible()
      await expect(runDialog.status).toHaveText('Stopped after 5 seconds. A loop or a timer may never end.', {
        timeout: 15_000,
      })
    })

    await test.step('Stop ends a run', async () => {
      await runDialog.run()
      await expect(runDialog.status).toHaveText('Running…')
      await runDialog.stopButton.click()
      await expect(runDialog.status).toHaveText('Stopped.')
    })

    await test.step('closing the dialog ends a run', async () => {
      await runDialog.run()
      await expect(runDialog.status).toHaveText('Running…')
      await runDialog.close()
      await expect(page.locator('iframe[sandbox]')).toHaveCount(0)
    })

    await test.step('output that never ends is stopped at its limit', async () => {
      await runDialog.openFrom(open)
      await runDialog.write('for (;;) console.log("again")')
      await runDialog.run()
      await expect(runDialog.status).toHaveText('Stopped: the output reached its limit.')
      await expect(runDialog.output.getByText('again')).toHaveCount(1000)
      await runDialog.close()
    })
    expect(await folioState(page)).toEqual(before)
  })

  test('code can’t reach the network', async ({ page, runDialog }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The engines and the sandbox are the same on every layout.')
    await signedInAt(page, LISTING)
    const before = await folioState(page)
    await runDialog.openFrom(runDialog.openButtons('JavaScript'))
    const origin = new URL(page.url()).origin
    for (const address of ['/account', `${origin}/account`]) {
      await runDialog.write(`const answer = await fetch('${address}')\nconsole.log(await answer.text())`)
      await runDialog.run()
      await expect(runDialog.status).toHaveText(/^Stopped by an error/)
      await expect(runDialog.hint).toHaveText('Code here has no network access.')
    }
    await runDialog.close()
    expect(await folioState(page)).toEqual(before)
  })

  test('code can’t touch Folio’s storage or page', async ({ page, runDialog }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The engines and the sandbox are the same on every layout.')
    await signedInAt(page, LISTING)
    const before = await folioState(page)
    await runDialog.openFrom(runDialog.openButtons('JavaScript'))
    for (const code of [
      "indexedDB.open('x')\nconsole.log('opened')",
      "caches.keys().then(() => console.log('opened'))",
      "parent.postMessage('x', '*')\nconsole.log('reached')",
    ]) {
      await runDialog.write(code)
      await runDialog.run()
      await expect(runDialog.status).toHaveText(/^Stopped by an error/)
      await expect(runDialog.output).not.toContainText(/opened|reached/)
    }
    await runDialog.close()
    expect(await folioState(page)).toEqual(before)
  })
})
