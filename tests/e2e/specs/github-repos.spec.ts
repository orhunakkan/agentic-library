import { readFileSync } from 'node:fs'
import { createUser } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'
import { MOVING_SECOND, SAMPLE_COMMIT } from '../support/github/fixture'
import { hydrated } from '../support/settle'

const badge = readFileSync(new URL('../../fixtures/images/tiny.png', import.meta.url))

test.describe('Repositories', () => {
  test('add a repository, read its README, follow a link, open code and see a Markdown file’s source', async ({
    page,
    siteNav,
    reposPage,
    runDialog,
  }) => {
    await page.route('https://img.shields.io/**', (route) => route.fulfill({ body: badge, contentType: 'image/png' }))
    await createUser(page.request, { signedIn: true })
    await page.goto('/library')
    await hydrated(page)

    const nav = await siteNav.open()
    await nav.getByRole('link', { name: 'Repositories' }).click()
    await expect(reposPage.title).toBeVisible()
    await hydrated(page)
    await expect(reposPage.empty).toBeVisible()
    await expect(reposPage.count).toHaveText('0 of 25 repositories')

    await reposPage.add('https://github.com/folio-test', { sent: false })
    await expect(reposPage.addError).toHaveText(
      'That’s not a repository’s address. Paste the repository’s own address, like https://github.com/addyosmani/agent-skills.',
    )

    await reposPage.add('https://github.com/folio-test/sample')
    const card = reposPage.card('folio-test/sample')
    await expect(card).toContainText('A fixture repository for Folio’s tests.')
    await expect(card).toContainText('Default branch main')
    await expect(card).toContainText(`Updated to ${SAMPLE_COMMIT.slice(0, 7)} · checked just now`)
    await expect(reposPage.count).toHaveText('1 of 25 repositories')
    await expectAccessible(page)
    await expectNoSideways(page)

    await reposPage.open('folio-test/sample')
    await expect(reposPage.viewerTitle).toHaveText('folio-test/sample')
    const readme = reposPage.readme
    await expect(readme.getByRole('heading', { level: 1, name: 'Sample repository' })).toBeVisible()
    await expect(readme.getByTestId('repo-front-matter')).toContainText('Sample repository')
    await expect(readme.getByText('Note', { exact: true })).toBeVisible()
    await expect(readme.getByText("This repository is a fixture for Folio's tests.")).toBeVisible()
    await expect(readme.getByRole('cell', { name: 'TypeScript' })).toBeVisible()
    const logo = readme.getByRole('img', { name: 'The Folio logo' })
    await expect(logo).toHaveAttribute('src', /\/raw\?path=docs%2Fimg%2Flogo\.png$/)
    await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    await expect(readme.getByTestId('repo-external-image')).toContainText('Build passing')
    await expect(readme.getByText('🚀')).toBeVisible()
    await expectAccessible(page)
    await expectNoSideways(page)

    await page.getByRole('button', { name: 'Show pictures from other sites' }).click()
    const shown = readme.getByRole('img', { name: 'Build passing' })
    await expect(shown).toHaveAttribute('referrerpolicy', 'no-referrer')
    await expect(readme.getByTestId('repo-external-image')).toHaveCount(0)

    await readme.getByRole('link', { name: 'guide' }).click()
    await expect(page).toHaveURL(/path=docs%2Fguide\.md#user-content-install$/)
    await expect(reposPage.file.getByRole('heading', { name: 'Install' })).toHaveAttribute('id', 'user-content-install')
    await expect(page.getByTestId('repo-breadcrumbs')).toContainText('sample/docs/guide.md')

    await reposPage.openFromTree('src/index.ts')
    await expect(reposPage.fileInfo).toContainText('index.ts · 123 bytes · 6 lines')
    await expect(reposPage.file).toContainText('export function add(a: number, b: number): number {')
    await expect(reposPage.file.locator('[data-n="6"]')).toContainText('export const answer = add(40, 2)')
    await expectAccessible(page)
    await expectNoSideways(page)

    await reposPage.openFromTree('examples/hello.js')
    await runDialog.openFrom(page.getByTestId('repo-run'))
    await expect(runDialog.editor).toHaveValue(/^const name = 'Folio'\nconsole\.log\(`Hello, \$\{name\}!`\)\n?$/)
    await runDialog.run()
    await expect(runDialog.output).toHaveText('Hello, Folio!')
    await runDialog.close()
    await expect(page.getByTestId('repo-run')).toBeFocused()

    await reposPage.openFromTree('README.md')
    await page.getByRole('link', { name: 'Code', exact: true }).click()
    await expect(page).toHaveURL(/view=code/)
    await expect(reposPage.file).toContainText('> [!NOTE]')
    await expect(page.getByRole('link', { name: 'Code', exact: true })).toHaveAttribute('aria-current', 'page')
  })

  test('refresh a repository that has moved on GitHub, then remove it', async ({
    page,
    request,
    reposPage,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The stub moves one repository for everyone; one browser is enough.')
    await request.post('/test-github/control/reset')
    await createUser(page.request, { signedIn: true })
    await reposPage.goto()
    await hydrated(page)
    await reposPage.add('https://github.com/folio-test/moving')
    await reposPage.open('folio-test/moving')
    await expect(reposPage.readme).toContainText('The first commit.')
    await hydrated(page)

    try {
      await request.post('/test-github/control/advance')
      await reposPage.refresh()
      await expect(reposPage.refreshed).toHaveText(`Updated to ${MOVING_SECOND.slice(0, 7)}.`)
      await expect(reposPage.readme).toContainText('The second commit.')
      const tree = await reposPage.tree()
      await expect(tree.locator('[data-testid="repo-tree-file"][data-key="CHANGELOG.md"]')).toBeVisible()

      await page.getByRole('link', { name: 'Repositories' }).first().click()
      await expect(reposPage.title).toBeVisible()
      await hydrated(page)
      const card = reposPage.card('folio-test/moving')
      await expect(card).toContainText(`Updated to ${MOVING_SECOND.slice(0, 7)}`)
      await card.getByRole('button', { name: 'Refresh' }).click()
      await expect(card.getByTestId('repo-refreshed')).toHaveText('Already up to date.')
    } finally {
      await request.post('/test-github/control/reset')
    }

    await reposPage.remove('folio-test/moving')
    await expect(reposPage.empty).toBeVisible()
    await expect(reposPage.count).toHaveText('0 of 25 repositories')
  })
})
