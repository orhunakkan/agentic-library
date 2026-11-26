import { type CoverInput, escapeXml, renderCoverSvg, wrapTitle } from '~/shared/content/cover'

export interface OgImage {
  type: 'image/jpeg' | 'image/png' | 'image/webp'
  base64: string
  width: number
  height: number
}

export interface OgCard {
  eyebrow: string
  title: string
  subtitle: string
  book?: CoverInput & { image?: OgImage }
  warm?: boolean
}

/** Where the cover sits on the card, as SVG position and size attributes. */
const COVER_BOX = 'x="852" y="96" width="292" height="438"'

function coverArt(book: NonNullable<OgCard['book']>): string {
  if (!book.image) return renderCoverSvg(book).replace('<svg ', `<svg ${COVER_BOX} `)
  const { type, base64 } = book.image
  return `<clipPath id="cover-clip"><rect ${COVER_BOX} rx="6"/></clipPath><image ${COVER_BOX} preserveAspectRatio="xMidYMid slice" clip-path="url(#cover-clip)" href="data:${type};base64,${base64}"/>`
}

const OG_COLORS = {
  from: '#0B0D17',
  to: '#1F2550',
  glow: '#B8F35C',
  eyebrow: '#B8F35C',
  eyebrowWarm: '#FCD34D',
  subtitle: '#A3A8C7',
} as const

export function renderOgSvg(card: OgCard): string {
  const { from, to, glow, subtitle: muted } = OG_COLORS
  const accent = card.warm ? OG_COLORS.eyebrowWarm : OG_COLORS.eyebrow
  const textWidth = card.book ? 26 : 34
  const lines = wrapTitle(card.title, textWidth).slice(0, 3)
  const size = lines.length > 2 ? 58 : 70
  const title = lines.map((line, i) => `<tspan x="80" y="${250 + i * size * 1.1}">${escapeXml(line)}</tspan>`).join('')
  const subtitleY = 250 + (lines.length - 1) * size * 1.1 + 70
  const cover = card.book
    ? `<g transform="rotate(4 980 315)"><rect ${COVER_BOX} rx="6" fill="#000" opacity=".35" transform="translate(10 18)"/>${coverArt(card.book)}</g>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient><radialGradient id="glow" cx=".85" cy=".1" r=".7"><stop offset="0" stop-color="${glow}" stop-opacity=".18"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="630" fill="url(#bg)"/><rect width="1200" height="630" fill="url(#glow)"/><text x="80" y="160" fill="${accent}" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="5">${escapeXml(card.eyebrow.toUpperCase())}</text><text fill="#ffffff" font-family="Georgia, DejaVu Serif, serif" font-size="${size}" font-weight="500">${title}</text><text x="80" y="${subtitleY}" fill="${muted}" font-family="DejaVu Sans, Arial, sans-serif" font-size="28">${escapeXml(card.subtitle)}</text><circle cx="89" cy="551" r="9" fill="${glow}"/><text x="110" y="560" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="700">Folio</text>${cover}</svg>`
}
