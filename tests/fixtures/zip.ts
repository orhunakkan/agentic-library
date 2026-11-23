import { crc32, deflateRawSync } from 'node:zlib'

export interface ZipInput {
  name: string
  data: string | Uint8Array
  store?: boolean
}

export function makeZip(files: readonly ZipInput[]): Uint8Array {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const data = typeof file.data === 'string' ? Buffer.from(file.data, 'utf8') : Buffer.from(file.data)
    const body = file.store ? data : deflateRawSync(data)
    const name = Buffer.from(file.name, 'utf8')
    const crc = crc32(data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x0800, 6)
    header.writeUInt16LE(file.store ? 0 : 8, 8)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(body.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, body)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0x0800, 8)
    entry.writeUInt16LE(file.store ? 0 : 8, 10)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(body.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, name)
    offset += header.length + name.length + body.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...local, directory, end]))
}

export interface EpubCover {
  name: string
  data: Uint8Array | string
  mediaType?: string
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function makeEpub({
  title = 'A Test Book',
  author = 'Ada Tester',
  language = 'en',
  files,
  cover,
  legacyCover,
  coverPath,
  description,
  isbn,
  identifiers = [],
  publisher,
  date,
  assets = [],
}: {
  title?: string
  author?: string
  language?: string
  files: { name: string; body: string }[]
  cover?: EpubCover
  legacyCover?: EpubCover
  coverPath?: string
  description?: string
  isbn?: string
  identifiers?: string[]
  publisher?: string
  date?: string
  assets?: { name: string; data: Uint8Array | string }[]
}): Uint8Array {
  const manifest = files.map((f, i) => `<item id="c${i}" href="${f.name}" media-type="application/xhtml+xml"/>`)
  const images: EpubCover[] = []
  const meta: string[] = []
  if (cover) {
    manifest.push(
      `<item id="cover-new" href="${cover.name}" media-type="${cover.mediaType ?? 'image/jpeg'}" properties="cover-image"/>`,
    )
    images.push(cover)
  }
  if (legacyCover) {
    manifest.push(
      `<item id="cover-old" href="${legacyCover.name}" media-type="${legacyCover.mediaType ?? 'image/jpeg'}"/>`,
    )
    meta.push('<meta name="cover" content="cover-old"/>')
    images.push(legacyCover)
  }
  if (coverPath)
    manifest.push(`<item id="cover-gone" href="${coverPath}" media-type="image/jpeg" properties="cover-image"/>`)
  const dc = [
    ...identifiers.map((id) => `<dc:identifier>${escapeXml(id)}</dc:identifier>`),
    isbn ? `<dc:identifier opf:scheme="ISBN">${escapeXml(isbn)}</dc:identifier>` : '',
    description ? `<dc:description>${escapeXml(description)}</dc:description>` : '',
    publisher ? `<dc:publisher>${escapeXml(publisher)}</dc:publisher>` : '',
    date ? `<dc:date>${escapeXml(date)}</dc:date>` : '',
  ].join('')
  const spine = files.map((_, i) => `<itemref idref="c${i}"/>`)
  return makeZip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    {
      name: 'META-INF/container.xml',
      data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    },
    {
      name: 'OEBPS/content.opf',
      data: `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>${language}</dc:language>${dc}${meta.join('')}</metadata><manifest>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`,
    },
    ...files.map((f) => ({
      name: `OEBPS/${f.name}`,
      data: `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${f.body}</body></html>`,
    })),
    ...images.map((image) => ({ name: `OEBPS/${image.name}`, data: image.data })),
    ...assets.map((asset) => ({ name: `OEBPS/${asset.name}`, data: asset.data })),
  ])
}

export function words(count: number, word = 'lorem'): string {
  return Array.from({ length: count }, () => word).join(' ')
}
