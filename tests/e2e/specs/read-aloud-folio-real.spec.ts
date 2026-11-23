import { folioVoice, voiceUrl } from '../../../src/shared/read-aloud/folio-voices.ts'
import { press } from '../pages'
import { fakeSpeech } from '../support/fake-speech'
import { expect, test } from '../support/fixtures'

const CORI = folioVoice('en_GB-cori-medium')

test.describe('The Folio voice’s real engine', () => {
  test('downloads Cori and reads a sentence aloud with her', async ({ page, readAloud }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The engine is the same on every layout.')
    if (!CORI) throw new Error('Cori is in the catalogue')
    const head = await page.request.head(voiceUrl(CORI.files.onnx, CORI.id))
    const real = head.headers()['content-length'] === String(CORI.files.onnx.bytes)
    if (!process.env.CI) test.skip(!real, 'No real Cori in VOICES_DIR')
    expect(real, 'the test server serves the real Cori').toBe(true)
    test.setTimeout(120_000)

    const errors: string[] = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(e.message))
    await fakeSpeech(page)
    await page.goto('/read/pride-and-prejudice/chapter-1')
    await readAloud.start()
    await readAloud.openSheet()
    await press(page, readAloud.offer.getByRole('button', { name: 'Download' }))
    await expect(page.getByRole('status').filter({ hasText: 'The Folio voice is ready.' })).toBeVisible({
      timeout: 60_000,
    })
    await page.keyboard.press('Escape')
    await press(page, readAloud.dockButton('Close player'))

    await page.reload()
    const pressed = Date.now()
    await readAloud.start()
    await expect(readAloud.dock).toContainText('Folio voice')
    await expect.poll(() => readAloud.speechPlaying(), { timeout: 60_000 }).toBe(true)
    const firstMs = Date.now() - pressed
    const sentence = await expect
      .poll(
        () =>
          readAloud.speechElement.evaluate((a: HTMLAudioElement) =>
            !a.paused && a.src.startsWith('blob:') && a.duration >= 2 ? a.duration : 0,
          ),
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0)
      .then(() =>
        readAloud.speechElement.evaluate((a: HTMLAudioElement) => ({ duration: a.duration, at: a.currentTime })),
      )
    expect(sentence.duration).toBeGreaterThanOrEqual(2)
    expect(sentence.duration).toBeLessThanOrEqual(15)
    await expect
      .poll(() => readAloud.speechElement.evaluate((a: HTMLAudioElement) => a.currentTime))
      .toBeGreaterThan(sentence.at)
    testInfo.annotations.push({
      type: 'folio-voice',
      description: `first audio ${firstMs} ms after Read aloud (engine and voice loading included); a sentence of ${sentence.duration.toFixed(2)} s`,
    })
    expect(errors).toEqual([])
  })
})
