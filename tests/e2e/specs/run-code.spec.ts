import { signedInAt } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, hydrated, test } from '../support/fixtures'

const LISTING = '/read/fixture-code-book/values-and-names/2'
const ORIGINAL = 'let ten = 10;\nconsole.log(ten * ten);\n// → 100'

test.describe('Run code', () => {
  test('a Pro reader runs a JavaScript example, edits and breaks it, resets it, and runs a TypeScript one', async ({
    page,
    runDialog,
  }) => {
    await signedInAt(page, LISTING)
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

  test('Python and SQL run, and code can’t outlast its time, reach the network or touch Folio', async ({
    page,
    runDialog,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The engines and the sandbox are the same on every layout.')
    test.setTimeout(90_000)

    await page.goto(LISTING)
    await hydrated(page)
    await runDialog.openFrom(runDialog.openButtons('JavaScript'))
    await expect(runDialog.signedOut).toHaveText('Sign in to run code. Running code is part of Pro.')
    await expect(runDialog.dialog.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(LISTING)}`,
    )
    await expect(runDialog.readOnlyCode).toHaveText(ORIGINAL)
    await expect(runDialog.editor).toHaveCount(0)
    await runDialog.close()

    await signedInAt(page, '/read/fixture-code-book/other-languages')
    const before = await page.evaluate(async () => ({
      cookie: document.cookie,
      storage: Object.keys(localStorage).sort(),
      databases: (await indexedDB.databases()).map((d) => d.name).sort(),
    }))

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

    await page.route('**/run-code/sqlite-*/sqlite3.mjs', (route) => route.abort())
    await runDialog.openFrom(runDialog.openButtons('SQL'))
    await runDialog.run()
    await expect(runDialog.status).toHaveText('Couldn’t get SQLite ready. Check your connection and try again.', {
      timeout: 30_000,
    })
    await runDialog.close()
    await page.unroute('**/run-code/sqlite-*/sqlite3.mjs')

    await runDialog.openFrom(runDialog.openButtons('SQL'))
    await runDialog.run()
    const table = runDialog.output.getByRole('table')
    await expect(table.getByRole('row')).toHaveCount(4, { timeout: 30_000 })
    await expect(table.getByRole('columnheader')).toHaveText(['title', 'pages'])
    await expect(table.getByRole('row').nth(1).getByRole('cell')).toHaveText(['Sanditon', '120'])
    await expect(runDialog.output).toContainText('3 rows changed')
    await runDialog.close()

    await page.goto(LISTING)
    await hydrated(page)
    const open = runDialog.openButtons('JavaScript')
    await runDialog.openFrom(open)

    await runDialog.write('while (true) {}')
    await runDialog.run()
    await expect(runDialog.stopButton).toBeVisible()
    await expect(runDialog.status).toHaveText('Stopped after 5 seconds. A loop or a timer may never end.', {
      timeout: 15_000,
    })
    await runDialog.run()
    await expect(runDialog.status).toHaveText('Running…')
    await runDialog.stopButton.click()
    await expect(runDialog.status).toHaveText('Stopped.')
    await runDialog.run()
    await expect(runDialog.status).toHaveText('Running…')
    await runDialog.close()
    await expect(page.locator('iframe[sandbox]')).toHaveCount(0)
    await runDialog.openFrom(open)

    await runDialog.write('for (;;) console.log("again")')
    await runDialog.run()
    await expect(runDialog.status).toHaveText('Stopped: the output reached its limit.')
    await expect(runDialog.output.getByText('again')).toHaveCount(1000)

    const origin = new URL(page.url()).origin
    for (const address of ['/account', `${origin}/account`]) {
      await runDialog.write(`const answer = await fetch('${address}')\nconsole.log(await answer.text())`)
      await runDialog.run()
      await expect(runDialog.status).toHaveText(/^Stopped by an error/)
      await expect(runDialog.hint).toHaveText('Code here has no network access.')
    }

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

    expect(
      await page.evaluate(async () => ({
        cookie: document.cookie,
        storage: Object.keys(localStorage).sort(),
        databases: (await indexedDB.databases()).map((d) => d.name).sort(),
      })),
    ).toEqual(before)
  })
})
