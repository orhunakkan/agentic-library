import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { bookPages } from '../../../src/shared/highlights/page-text.ts'
import { createUser, saveKey, signedInAt, signInOverHttp, validKey } from '../support/accounts'
import { downloadText } from '../support/downloads'
import { elevenLabsKey } from '../support/elevenlabs-stub'
import { expect, expectAccessible, settleNavigations, test } from '../support/fixtures'
import { importViaApi, postJson } from '../support/imports'
import { openAiKey } from '../support/openai-stub'

test.describe('Account', () => {
  test('the Storage section shows usage against the hosted limits, and counts an imported book', async ({
    page,
    baseURL,
    accountPage,
  }) => {
    await createUser(page.request, { signedIn: true })
    await accountPage.goto()
    await expect(accountPage.storageLine('books')).toHaveText('Books: 0 of 25 books')
    await expect(accountPage.storageLine('articles')).toHaveText('Saved articles: 0 of 500 saved articles')
    await expect(accountPage.storageLine('audio')).toHaveText('Audiobooks: 0 KB of 1 GB of audiobooks')
    await expect(accountPage.storageLine('pictures')).toHaveText('Pictures: 0 KB of 100 MB of pictures')
    await expect(accountPage.storage.locator('meter')).toHaveCount(4)
    await expectAccessible(page)

    await importViaApi(page.request, baseURL ?? '', {
      title: 'Counted',
      chapters: [{ title: 'One', text: 'A few words to count.' }],
    })
    await accountPage.goto()
    await expect(accountPage.storageLine('books')).toHaveText('Books: 1 of 25 books')
  })

  test('lists the sessions; changing the password signs out every other one', async ({
    page,
    browser,
    accountPage,
  }) => {
    const user = await createUser(page.request, { signedIn: true })
    const other = await browser.newContext()
    const otherPage = settleNavigations(await other.newPage())
    try {
      await signInOverHttp(other.request, user)
      await accountPage.goto()
      const sessions = accountPage.sessions
      await expect(sessions.getByRole('listitem')).toHaveCount(2)
      await expect(sessions.getByText('This device')).toHaveCount(1)
      await expect(sessions.getByRole('button', { name: 'Sign out everywhere else' })).toBeVisible()
      await expectAccessible(page)

      const form = accountPage.changePasswordSection
      const newPassword = 'a brand new e2e password'
      await accountPage.changePassword('not my password at all', newPassword)
      await expect(accountPage.alert).toHaveText('Your current password is incorrect.')
      await expect(form.getByLabel('New password', { exact: true })).toHaveAttribute('minlength', '15')

      await accountPage.changePassword(user.password, newPassword)
      await expect(accountPage.status).toHaveText('Password changed. Every other session has been signed out.')
      await otherPage.goto('/account')
      await expect(otherPage).toHaveURL(/\/login\?next=%2Faccount$/)

      await accountPage.goto()
      await expect(page).toHaveURL(/\/account$/)
      await expect(sessions.getByRole('listitem')).toHaveCount(1)
      await expect(sessions.getByRole('button', { name: 'Sign out everywhere else' })).toHaveCount(0)
    } finally {
      await other.close()
    }
  })
})

test.describe('Your data', () => {
  test('download your data', async ({ page, baseURL, accountPage }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'A download; account-data.db.test.ts covers its content.')
    const user = await signedInAt(page, '/account')
    const [first] = bookPages(JSON.parse(readFileSync('tests/e2e/content/books/pride-and-prejudice.json', 'utf8')))
    if (!first) throw new Error('no first page')
    const origin = baseURL ?? ''
    const highlight = await postJson(page.request, origin, '/account/highlights/new', {
      book: 'pride-and-prejudice',
      position: { chapter: first.chapterSlug, page: first.page },
      start: 0,
      end: 20,
      text: first.text.slice(0, 20),
      color: 'yellow',
      note: null,
    })
    expect(highlight.status()).toBe(201)
    const shelf = await postJson(page.request, origin, '/account/shelves/new', {
      name: 'Downloaded shelf',
      book: 'pride-and-prejudice',
    })
    expect(shelf.status()).toBe(201)

    const section = accountPage.yourData
    const downloading = page.waitForEvent('download')
    await section.getByRole('link', { name: 'Download your data' }).click()
    const download = await downloading
    const date = new Date().toISOString().slice(0, 10)
    expect(download.suggestedFilename()).toBe(`folio-account-${user.username}-${date}.json`)
    const text = await downloadText(download)
    const data = JSON.parse(text)
    expect(data).toMatchObject({ format: 'folio-account', version: 1, account: { username: user.username } })
    expect(data.highlights.map((h: { text: string }) => h.text)).toEqual([first.text.slice(0, 20)])
    expect(data.shelves.map((s: { name: string }) => s.name)).toEqual(['Downloaded shelf'])
    expect(text).not.toContain(user.password)
    expect(text).not.toMatch(/password_?hash|\$argon2/i)
  })
})

test.describe('Delete account', () => {
  test('delete your account: needs the password, then the account is gone', async ({ page, accountPage }) => {
    const user = await signedInAt(page, '/account')
    await page.evaluate(() => localStorage.setItem('ask:u-00000000-0000-4000-8000-000000000000', '{}'))
    const section = accountPage.deleteAccount
    await expect(page.getByRole('main').getByRole('heading', { level: 2, name: 'Plan' })).toHaveCount(0)
    await expect(page.getByRole('main')).not.toContainText(/\bPro\b|\bplan\b|subscription/)

    await accountPage.deleteWith('not my password at all')
    await expect(section.getByRole('alert')).toHaveText('Your password is incorrect.')
    await expect(section.getByLabel('Current password')).toHaveAttribute('aria-describedby', 'delete-error')

    await accountPage.deleteWith(user.password)
    await expect(page).toHaveURL(/\/login\?status=account-deleted$/)
    await expect(accountPage.status).toHaveText('Your account and everything in it have been deleted.')
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('ask:u-00000000-0000-4000-8000-000000000000')))
      .toBeNull()
  })
})

async function collectExposure(page: Page, run: () => Promise<void>): Promise<string> {
  const bodies: Promise<string>[] = []
  const onResponse = (response: { text: () => Promise<string> }) => bodies.push(response.text().catch(() => ''))
  page.on('response', onResponse)
  try {
    await run()
  } finally {
    page.off('response', onResponse)
  }
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  return [...(await Promise.all(bodies)), await page.content(), storage].join('\n')
}

test.describe('API keys', () => {
  test('save, replace and delete a key; the key never comes back to the browser', async ({ page, accountPage }) => {
    const first = validKey('1111')
    const second = validKey('2222')
    await signedInAt(page, '/account/api-keys')
    const anthropic = accountPage.anthropic
    const model = accountPage.model
    await expect(model.getByRole('radio', { name: /Claude Opus 5\.5/ })).toBeChecked()
    await expect(model.getByRole('radio')).toHaveCount(6)
    await expectAccessible(page)

    await accountPage.saveAnthropicKey('sk-ant-api03-this-is-a-fake-key-0000')
    await expect(accountPage.alert).toHaveText('This key was rejected.')
    await expect(anthropic.getByTestId('saved-key')).toHaveCount(0)

    const seen = await collectExposure(page, async () => {
      await accountPage.saveAnthropicKey(first)
      await expect(accountPage.status).toHaveText('Key saved.')
      await expect(anthropic.getByTestId('saved-key')).toHaveText('sk-ant-…1111')
      await expect(anthropic.getByText('not used yet')).toBeVisible()

      await anthropic.getByText('Replace').click()
      await accountPage.saveAnthropicKey(second, 'New Anthropic API key')
      await expect(accountPage.status).toHaveText('Key saved.')
      await expect(anthropic.getByTestId('saved-key')).toHaveText('sk-ant-…2222')
      await expectAccessible(page)
      await accountPage.gotoApiKeys()
      await expect(anthropic.getByTestId('saved-key')).toHaveText('sk-ant-…2222')
    })
    expect(seen).not.toContain(first)
    expect(seen).not.toContain(second)
    expect(seen).not.toContain('x'.repeat(16))

    await anthropic.getByRole('button', { name: 'Delete' }).click()
    await expect(accountPage.status).toHaveText('Key deleted.')
    await expect(anthropic.getByTestId('saved-key')).toHaveCount(0)
    await expect(anthropic.getByLabel('Anthropic API key', { exact: true })).toBeVisible()
  })

  test('the ElevenLabs key is saved here, and the voice model chosen', async ({ page }) => {
    await signedInAt(page, '/account/api-keys')
    const section = page.getByRole('region', { name: 'ElevenLabs' })
    await expect(section.getByText('ElevenLabs voices read books aloud in Read aloud, on your key.')).toBeVisible()
    await section.getByLabel('ElevenLabs API key', { exact: true }).fill('sk-ant-api03-pasted-in-the-wrong-place')
    await section.getByRole('button', { name: 'Save key' }).click()
    await expect(section.getByRole('alert')).toHaveText(
      'That’s an Anthropic key. Paste it in the Anthropic section above.',
    )

    const key = elevenLabsKey('4321', randomBytes(6).toString('hex'))
    await section.getByLabel('ElevenLabs API key', { exact: true }).fill(key)
    await section.getByRole('button', { name: 'Save key' }).click()
    await expect(section.getByRole('status')).toHaveText('Key saved.')
    await expect(section.getByTestId('saved-key')).toHaveText('…4321')
    await expect(section.getByTestId('speech-usage')).toHaveText('Read aloud hasn’t used this key in the last 30 days.')
    expect(await page.content()).not.toContain(key)

    await expect(section.getByRole('radio', { name: /Eleven v4 Turbo/ })).toBeChecked()
    await section.getByRole('radio', { name: /^Eleven v4 The most natural/ }).check()
    await section.getByRole('button', { name: 'Save voice model' }).click()
    await expect(section.getByRole('status')).toHaveText('Voice model saved.')
    await expect(section.getByRole('radio', { name: /^Eleven v4 The most natural/ })).toBeChecked()
    await expect(section.getByText('The most natural, about $4.30 an hour of listening')).toBeVisible()
    await expectAccessible(page)
  })
})

test.describe('An OpenAI key', () => {
  test('save, replace and delete it; wrong keys are refused with their own words', async ({ page }) => {
    await signedInAt(page, '/account/api-keys')
    const openai = page.getByRole('region', { name: 'OpenAI' })
    const anthropic = page.getByRole('region', { name: 'Anthropic' })
    await expect(openai.getByText(/An OpenAI key runs Ask the book and Translate/)).toBeVisible()
    const fill = async (section: typeof openai, label: string, key: string) => {
      await section.getByLabel(label, { exact: true }).fill(key)
      await section.getByRole('button', { name: 'Save', exact: true }).click()
    }

    await fill(openai, 'OpenAI API key', 'sk-ant-api03-pasted-in-the-wrong-place')
    await expect(openai.getByRole('alert')).toHaveText(
      'That’s an Anthropic key. Paste it in the Anthropic section above.',
    )
    await fill(anthropic, 'Anthropic API key', openAiKey())
    await expect(anthropic.getByRole('alert')).toHaveText('That’s an OpenAI key. Paste it in the OpenAI section below.')
    await fill(openai, 'OpenAI API key', 'not an openai key')
    await expect(openai.getByRole('alert')).toHaveText(
      'That doesn’t look like an OpenAI API key. Keys start with sk- and have no spaces.',
    )
    await fill(openai, 'OpenAI API key', 'sk-proj-this-is-a-fake-key-0000')
    await expect(openai.getByRole('alert')).toHaveText('This key was rejected.')
    await expect(openai.getByTestId('saved-key')).toHaveCount(0)

    const first = openAiKey('1111')
    const second = openAiKey('2222')
    await fill(openai, 'OpenAI API key', first)
    await expect(openai.getByRole('status')).toHaveText('Key saved.')
    await expect(openai.getByTestId('saved-key')).toHaveText('sk-…1111')
    await expect(openai.getByText('not used yet')).toBeVisible()
    await openai.getByText('Replace').click()
    await fill(openai, 'New OpenAI API key', second)
    await expect(openai.getByTestId('saved-key')).toHaveText('sk-…2222')
    expect(await page.content()).not.toContain(second)
    await expectAccessible(page)

    await openai.getByRole('button', { name: 'Delete' }).click()
    await expect(openai.getByRole('status')).toHaveText('Key deleted.')
    await expect(openai.getByTestId('saved-key')).toHaveCount(0)
  })

  test('the one model list labels each model with its provider and says which keys are missing', async ({
    page,
    accountPage,
  }) => {
    await signedInAt(page, '/account/api-keys')
    const model = accountPage.model
    await expect(model.getByRole('radio', { name: /Claude Opus 5\.5 \(default\) · Anthropic/ })).toBeChecked()
    await expect(model.getByRole('radio', { name: /GPT-6\.2 Astra · OpenAI/ })).toBeVisible()
    await expect(model.getByTestId('api-keys-model-no-key')).toHaveCount(6)
    await saveKey(page, openAiKey('3333'), 'openai')
    await accountPage.gotoApiKeys()
    await expect(model.getByTestId('api-keys-model-no-key')).toHaveCount(3)
    await expect(model.getByTestId('api-keys-model-no-key').first()).toHaveText('No Anthropic key saved yet.')

    await model.getByRole('radio', { name: /GPT-6 Luna/ }).check()
    await model.getByRole('button', { name: 'Save model' }).click()
    await expect(accountPage.status).toHaveText('Model saved.')
    await expect(model.getByRole('radio', { name: /GPT-6 Luna/ })).toBeChecked()
  })
})

test.describe('Model for agent features, without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('choosing a model is a plain form post', async ({ page, accountPage }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'A plain form post; the layout adds nothing.')
    await createUser(page.request, { signedIn: true })
    await accountPage.gotoApiKeys()

    const section = accountPage.model
    await section.getByRole('radio', { name: /Claude Haiku 5\.5/ }).check()
    await section.getByRole('button', { name: 'Save model' }).click()
    await expect(accountPage.status).toHaveText('Model saved.')
    await expect(section.getByRole('radio', { name: /Claude Haiku 5\.5/ })).toBeChecked()
    await accountPage.gotoApiKeys()
    await expect(section.getByRole('radio', { name: /Claude Haiku 5\.5/ })).toBeChecked()
  })
})
