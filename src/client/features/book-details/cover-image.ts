import { type Canvas, canvasOf } from '~/client/features/import/picture-draw'
import { COVER_MIN_SIDE, COVER_QUALITIES, fitWithin } from '~/shared/import/image'
import { COVER_MAX_HEIGHT, COVER_MAX_WIDTH, MAX_COVER_BYTES } from '~/shared/import/limits'

export type DrawnCover = { blob: Blob; width: number; height: number } | { problem: 'unreadable' | 'small' }

function encode(canvas: Canvas, quality: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality }).catch(() => null)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

export async function drawCover(source: Blob): Promise<DrawnCover> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(source)
  } catch {
    return { problem: 'unreadable' }
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, COVER_MAX_WIDTH, COVER_MAX_HEIGHT)
    if (width < COVER_MIN_SIDE || height < COVER_MIN_SIDE) return { problem: 'small' }
    const canvas = canvasOf(width, height)
    const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
    if (!context) return { problem: 'unreadable' }
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    for (const quality of COVER_QUALITIES) {
      const blob = await encode(canvas, quality)
      if (!blob) return { problem: 'unreadable' }
      if (blob.type !== 'image/jpeg')
        return blob.type === 'image/png' && blob.size <= MAX_COVER_BYTES
          ? { blob, width, height }
          : { problem: 'unreadable' }
      if (blob.size <= MAX_COVER_BYTES) return { blob, width, height }
    }
    return { problem: 'unreadable' }
  } finally {
    bitmap.close()
  }
}
