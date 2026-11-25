import '@tanstack/react-start/server-only'
import { checkBookImage } from '../../shared/import/image.ts'
import { MAX_IMAGE_BYTES } from '../../shared/import/limits.ts'
import { isUuid } from '../../shared/uuid.ts'
import { noStoreJson, sessionForRequest } from '../auth.ts'
import { IMPORT_CODES, type ImportErrorCode } from '../book-actions.ts'
import { COVER_HEADERS, imageText } from '../book-details/actions.ts'
import { getDb, isDatabaseConfigured } from '../db.ts'
import { logError } from '../redact.ts'
import { type RawBody, signedInEndpoints } from '../signed-in.ts'
import { parseImageNumber } from './input.ts'
import { loadImage, newImage, storeImage } from './store.ts'

const pictures = signedInEndpoints<ImportErrorCode>({ maxBytes: MAX_IMAGE_BYTES, codes: IMPORT_CODES })
const { fail } = pictures
const notFound = () => fail(404, 'not-found')

function checkPicture({ bytes, type }: RawBody) {
  const checked = checkBookImage(bytes)
  return checked.ok && checked.info.type === type ? { bytes, info: checked.info } : null
}

export const handleImage = (request: Request, id: string, number: string) =>
  pictures.post(
    request,
    {
      log: 'book picture upload',
      signedOut: 404,
      body: { bytes: MAX_IMAGE_BYTES, types: ['image/jpeg', 'image/png'] },
      before: () => {
        const n = parseImageNumber(number)
        return isUuid(id) && n !== null ? n : notFound()
      },
      parse: checkPicture,
    },
    async ({ session, db, pre: n, input: { bytes, info } }) => {
      const result = await storeImage(db, session.userId, id, n, newImage(bytes, info))
      if (result === 'missing') return notFound()
      if (result === 'position') return fail(400, 'invalid')
      if (result !== 'ok') return fail(409, 'quota', { scope: result.quota, max: result.max })
      return noStoreJson(200, { ok: true, width: info.width, height: info.height })
    },
  )

const pictureNotFound = () => imageText(404, 'Not found')

export async function serveImage(request: Request, id: string, number: string): Promise<Response> {
  const n = parseImageNumber(number)
  if (!isUuid(id) || n === null || !isDatabaseConfigured()) return pictureNotFound()
  const session = await sessionForRequest(request)
  if (!session) return pictureNotFound()
  try {
    const image = await loadImage(getDb(), session.userId, id, n)
    if (!image) return pictureNotFound()
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        'content-type': image.mediaType,
        'content-length': String(image.bytes.length),
        etag: `"${image.sha256}"`,
        ...COVER_HEADERS,
      },
    })
  } catch (error) {
    logError('book picture read', error)
    return imageText(503, 'Unavailable')
  }
}
