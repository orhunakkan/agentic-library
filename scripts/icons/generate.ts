import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { appIconSvg } from '../../src/shared/pwa/app-icon.ts'
import { APP_ICONS, APPLE_TOUCH_ICON } from '../../src/shared/pwa/manifest.ts'

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url))

const targets = new Map<string, number>([[APPLE_TOUCH_ICON.src, APPLE_TOUCH_ICON.size]])
for (const icon of APP_ICONS) targets.set(icon.src, Number(icon.sizes.split('x')[0]))

for (const [src, size] of targets) {
  const png = new Resvg(appIconSvg(size), { fitTo: { mode: 'width', value: size } }).render().asPng()
  const file = join(PUBLIC, src)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, png)
  console.log(`${src} (${size}×${size}, ${png.length} bytes)`)
}
