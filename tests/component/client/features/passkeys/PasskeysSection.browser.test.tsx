import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page } from 'vitest/browser'
import { PasskeysSection } from '~/client/features/passkeys/PasskeysSection'
import { mount } from '../../../../support/client/mount'

/** The server's answer to the password, as POST /account/passkeys/options gives it for a wrong one. */
const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const section = page.getByRole('region', { name: 'Passkeys' })
const password = section.getByLabelText('Current password')

let fetchSpy: MockInstance<typeof fetch>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

describe('PasskeysSection', () => {
  it('says a wrong password beside the field, and adds no passkey', async () => {
    fetchSpy.mockResolvedValue(answer(400, { error: 'password' }))
    const create = vi.spyOn(navigator.credentials, 'create')
    mount(<PasskeysSection username="reader" initial={[]} max={10} removed={null} />)

    await page.getByRole('button', { name: 'Add a passkey' }).click()
    /** Found by its label, so check it's a password box that a screen reader names after that label. */
    await expect.element(password).toHaveAttribute('type', 'password')
    await expect.element(password).toHaveAccessibleName('Current password')
    await expect.element(password).not.toHaveAccessibleDescription()
    await password.fill('not my password at all')
    await page.getByRole('button', { name: 'Continue' }).click()

    const error = page.getByRole('alert')
    await expect.element(error).toHaveTextContent('Your password is incorrect.')
    await expect.element(password).toHaveAttribute('aria-invalid', 'true')
    await expect.element(password).toHaveAttribute('aria-describedby', error.element().id)
    await expect.element(password).toHaveAccessibleDescription('Your password is incorrect.')
    await expect.element(section.getByRole('list', { name: 'Your passkeys' })).not.toBeInTheDocument()
    /** Plain text in the Passkeys region, with no role or name of its own to check. */
    await expect.element(section.getByText('No passkeys yet.')).toBeVisible()
    expect(fetchSpy).toHaveBeenCalledWith('/account/passkeys/options', expect.objectContaining({ method: 'POST' }))
    expect(create).not.toHaveBeenCalled()
  })
})
