import { readFileSync } from 'node:fs'
import { type Download, test } from '@playwright/test'

export async function downloadText(download: Download): Promise<string> {
  const file = test.info().outputPath(download.suggestedFilename())
  await download.saveAs(file)
  return readFileSync(file, 'utf8')
}
