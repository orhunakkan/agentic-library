import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const DIR = import.meta.dirname

interface Drawing {
  width: number
  height: number
  type: 'image/jpeg' | 'image/png'
  quality?: number
  noise?: boolean
  hue: number
  label: string
}

const browser = await chromium.launch()
const page = await browser.newPage()

async function draw(name: string, d: Drawing): Promise<void> {
  const dataUrl = await page.evaluate((d) => {
    const canvas = document.createElement('canvas')
    canvas.width = d.width
    canvas.height = d.height
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    if (d.noise) {
      const image = ctx.createImageData(d.width, d.height)
      let seed = 12345
      for (let i = 0; i < image.data.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        image.data[i] = i % 4 === 3 ? 255 : seed >> 23
      }
      ctx.putImageData(image, 0, 0)
    } else {
      ctx.fillStyle = `hsl(${d.hue} 45% 35%)`
      ctx.fillRect(0, 0, d.width, d.height)
      ctx.fillStyle = `hsl(${d.hue} 50% 85%)`
      ctx.fillRect(d.width * 0.1, d.height * 0.1, d.width * 0.8, d.height * 0.04)
      ctx.fillRect(d.width * 0.1, d.height * 0.86, d.width * 0.8, d.height * 0.04)
      ctx.font = `bold ${Math.round(d.height / 10)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(d.label, d.width / 2, d.height / 2)
    }
    return canvas.toDataURL(d.type, d.quality)
  }, d)
  writeFileSync(join(DIR, name), Buffer.from(dataUrl.split(',')[1] as string, 'base64'))
}

await draw('cover.jpg', { width: 400, height: 600, type: 'image/jpeg', quality: 0.82, hue: 200, label: 'Cover' })
await draw('wide.png', { width: 900, height: 600, type: 'image/png', hue: 30, label: 'Wide' })
await draw('tiny.png', { width: 40, height: 60, type: 'image/png', hue: 120, label: '' })
await draw('huge.jpg', { width: 720, height: 1080, type: 'image/jpeg', quality: 0.9, noise: true, hue: 0, label: '' })
writeFileSync(join(DIR, 'not-an-image.jpg'), 'This file is named .jpg, but it is text.\n')

await browser.close()
