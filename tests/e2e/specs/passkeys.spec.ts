import { shortDate } from '../../../src/shared/lib/site.ts'
import { createUser } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'
import { useVirtualAuthenticator } from '../support/virtual-authenticator'

test.describe('Passkeys', () => {
  test('add a passkey, sign in with it, and remove it', async ({ page, accountPage, loginPage }, testInfo) => {
    const credentials = await useVirtualAuthenticator(page.context())
    const user = await createUser(page.request, { signedIn: true })
    await page.goto('/account#passkeys')
    const passkeys = accountPage.passkeys
    await expect(passkeys.region.getByText('No passkeys yet.')).toBeVisible()
    await expect(passkeys.addButton).toBeVisible()
    await expectAccessible(page)

    await passkeys.add(user.password)
    await expect(passkeys.status).toHaveText('Passkey added.')
    await expect(passkeys.rows).toHaveCount(1)
    await expect(passkeys.rows.first()).toContainText(`Added ${shortDate(new Date())} · Never used`)
    expect(await credentials.get({ rpId: 'localhost' })).toHaveLength(1)
    if (testInfo.project.name === 'phone') await expectNoSideways(page)

    await page.getByRole('main').getByRole('button', { name: 'Sign out', exact: true }).click()
    await page.waitForURL('**/library')
    await loginPage.goto('/account')
    await loginPage.signInWithPasskey()
    await expect(page).toHaveURL(/\/account$/)
    await expect(passkeys.rows.first()).toContainText(`Last used ${shortDate(new Date())}`)

    await passkeys.remove(passkeys.rows.first())
    await expect(passkeys.status).toHaveText('Passkey removed.')
    await expect(passkeys.region.getByText('No passkeys yet.')).toBeVisible()
    await expectAccessible(page)
  })
})
