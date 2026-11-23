import { expect, expectAccessible, swipe, test } from '../support/fixtures'

test.describe('Mobile', () => {
  test('library stacks and stays accessible', async ({ page, libraryPage, siteNav }) => {
    await libraryPage.goto()
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
    const narrow = !siteNav.hasSidebar
    await expect(siteNav.menuButton).toBeVisible({ visible: narrow })
    await expect(siteNav.sidebar).toBeVisible({ visible: !narrow })
    await expectAccessible(page)
  })

  test('the menu drawer opens, navigates and closes', async ({ page, siteNav }) => {
    await page.goto('/library/jane-austen')
    await siteNav.menuButton.click()
    const drawer = siteNav.drawer
    await expect(drawer.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await expectAccessible(page)
    await drawer.getByRole('link', { name: 'All books' }).click()
    await expect(page).toHaveURL('/library')
    await expect(drawer).toHaveCount(0)

    await siteNav.menuButton.click()
    await expect(drawer).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
  })

  test('reader toolbar opens the contents drawer, Esc closes it', async ({ page, readerPage }) => {
    await readerPage.goto('confessions-of-al-ghazzali', 8)
    await expect(readerPage.contents.panel).toBeHidden()
    await readerPage.contents.toolbarButton.click()
    const drawer = readerPage.contents.drawer
    await expect(drawer.getByRole('link', { name: /Introduction/ })).toHaveAttribute('aria-current', 'page')
    await expectAccessible(page)
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
  })

  test('swiping turns pages', async ({ page, readerPage }) => {
    await readerPage.goto('confessions-of-al-ghazzali', 8)
    await swipe(page, 200, 170)
    await swipe(page, 320, 120)
    await expect(page).toHaveURL('/read/confessions-of-al-ghazzali/9')
    await expect(page.getByText('Chapter 1 · Page 3 of 3')).toBeVisible()
    await swipe(page, 80, 300)
    await expect(page).toHaveURL('/read/confessions-of-al-ghazzali/8')
    await expect(page.getByText('Chapter 1 · Page 2 of 3')).toBeVisible()
  })

  test('settings hide the desktop-only panel option', async ({ readerPage }) => {
    await readerPage.goto('pride-and-prejudice', 'chapter-1')
    await readerPage.settingsButton.click()
    const panel = readerPage.settings
    await expect(panel.getByText('Theme')).toBeVisible()
    await expect(panel.getByText('Contents panel')).toHaveCount(0)
  })
})
