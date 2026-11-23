import type { PictureType } from '~/shared/import/blocks'
import { checkBookImage, fitWithin, outputTypeFor, svgSize } from '~/shared/import/image'
import { IMAGE_MAX_HEIGHT, IMAGE_MAX_WIDTH, IMAGE_MIN_SIDE, MAX_IMAGE_BYTES } from '~/shared/import/limits'

export type DrawnPicture = { blob: Blob; width: number; height: number } | { problem: 'unreadable' | 'large' | 'small' }

export type Canvas = OffscreenCanvas | HTMLCanvasElement
type Source = ImageBitmap | HTMLImageElement
type OutputType = 'image/png' | 'image/jpeg'

const SVG_DEFAULT = { width: 800, height: 600 }
const SCALES = [1, 0.75, 0.5] as const
const JPEG_QUALITY = 0.85
const FALLBACK_QUALITIES = [0.85, 0.75, 0.6] as const

export function canvasOf(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function canvasBlob(canvas: Canvas, type: OutputType, quality?: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality })
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

async function encode(source: Source, width: number, height: number, type: OutputType, quality: number) {
  const canvas = canvasOf(width, height)
  const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
  if (!context) return null
  if (type === 'image/jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
  }
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, width, height)
  try {
    return await canvasBlob(canvas, type, quality)
  } catch {
    return null
  }
}

async function acceptable(blob: Blob | null, type: OutputType): Promise<boolean> {
  if (!blob || blob.type !== type || blob.size > MAX_IMAGE_BYTES) return false
  return checkBookImage(new Uint8Array(await blob.arrayBuffer())).ok
}

async function shrinkToFit(source: Source, width: number, height: number, type: OutputType): Promise<DrawnPicture> {
  const sized = (scale: number) => ({
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  })
  const attempts: { scale: number; type: OutputType; quality: number }[] = [
    ...SCALES.map((scale) => ({ scale, type, quality: JPEG_QUALITY })),
    ...(type === 'image/png'
      ? FALLBACK_QUALITIES.map((quality) => ({ scale: 1, type: 'image/jpeg' as const, quality }))
      : []),
    ...FALLBACK_QUALITIES.slice(1).map((quality) => ({ scale: 0.5, type: 'image/jpeg' as const, quality })),
  ]
  for (const attempt of attempts) {
    const size = sized(attempt.scale)
    if (size.width < IMAGE_MIN_SIDE || size.height < IMAGE_MIN_SIDE) continue
    const blob = await encode(source, size.width, size.height, attempt.type, attempt.quality)
    if (blob === null && attempt.scale === 1 && attempt.type === type) return { problem: 'unreadable' }
    if (await acceptable(blob, attempt.type)) return { blob: blob as Blob, ...size }
  }
  return { problem: 'large' }
}

async function decodeSvg(bytes: Uint8Array): Promise<{ image: HTMLImageElement; release: () => void } | null> {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/svg+xml' }))
  const image = new Image()
  image.src = url
  try {
    await image.decode()
    return { image, release: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    return null
  }
}

export async function drawPicture(bytes: Uint8Array, type: PictureType): Promise<DrawnPicture> {
  const output = outputTypeFor(type)
  if (type === 'image/svg+xml') {
    const decoded = await decodeSvg(bytes)
    if (!decoded) return { problem: 'unreadable' }
    try {
      const own = svgSize(new TextDecoder('utf-8').decode(bytes)) ?? SVG_DEFAULT
      const { width, height } = fitWithin(own.width * 2, own.height * 2, IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT)
      if (width < IMAGE_MIN_SIDE || height < IMAGE_MIN_SIDE) return { problem: 'small' }
      return await shrinkToFit(decoded.image, width, height, output)
    } finally {
      decoded.release()
    }
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type }))
  } catch {
    return { problem: 'unreadable' }
  }
  try {
    if (bitmap.width < IMAGE_MIN_SIDE || bitmap.height < IMAGE_MIN_SIDE) return { problem: 'small' }
    const { width, height } = fitWithin(bitmap.width, bitmap.height, IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT)
    return await shrinkToFit(bitmap, width, height, output)
  } finally {
    bitmap.close()
  }
}
