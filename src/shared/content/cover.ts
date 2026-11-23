import type { CoverStyle } from './schema'

export interface CoverInput {
  title: string
  author: string
  cover: CoverStyle
}

export const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function wrapTitle(title: string, maxChars: number): string[] {
  const words = title.split(/\s+/).filter(Boolean)
  const memo = new Map<string, { width: number; lines: string[] }>()
  const solve = (i: number, k: number): { width: number; lines: string[] } => {
    const key = `${i}:${k}`
    const hit = memo.get(key)
    if (hit) return hit
    let result = { width: Number.POSITIVE_INFINITY, lines: [] as string[] }
    if (k === 1) {
      const line = words.slice(i).join(' ')
      result = { width: line.length, lines: [line] }
    } else {
      for (let j = i + 1; j <= words.length - (k - 1); j++) {
        const line = words.slice(i, j).join(' ')
        const rest = solve(j, k - 1)
        const width = Math.max(line.length, rest.width)
        if (width < result.width) result = { width, lines: [line, ...rest.lines] }
      }
    }
    memo.set(key, result)
    return result
  }
  return words.length === 0 ? [] : solve(0, Math.min(greedyLineCount(words, maxChars), words.length)).lines
}

function greedyLineCount(words: string[], maxChars: number): number {
  let count = 0
  let current = ''
  for (const word of words) {
    if (current && `${current} ${word}`.length <= maxChars) current = `${current} ${word}`
    else {
      current = word
      count++
    }
  }
  return count
}

function motif(kind: CoverStyle['motif'], ink: string): string {
  const s = `stroke="${ink}" fill="none"`
  switch (kind) {
    case 'arch':
      return [0, 1, 2, 3, 4]
        .map((i) => {
          const w = 150 + i * 46
          const top = 150 + i * 26
          return `<path ${s} stroke-opacity="${0.34 - i * 0.05}" stroke-width="1.5" d="M${300 - w / 2} 640 V${top + w * 0.55} Q${300 - w / 2} ${top + w * 0.12} 300 ${top} Q${300 + w / 2} ${top + w * 0.12} ${300 + w / 2} ${top + w * 0.55} V640"/>`
        })
        .join('')
    case 'star': {
      const square = (r: number, rot: number, o: number) =>
        `<rect ${s} stroke-opacity="${o}" stroke-width="1.5" x="${300 - r}" y="${330 - r}" width="${r * 2}" height="${r * 2}" transform="rotate(${rot} 300 330)"/>`
      return [70, 120, 170]
        .map((r, i) => square(r, 0, 0.32 - i * 0.07) + square(r, 45, 0.32 - i * 0.07))
        .concat(`<circle ${s} stroke-opacity="0.2" cx="300" cy="330" r="228"/>`)
        .join('')
    }
    case 'rings':
      return [60, 105, 150, 195, 240, 285]
        .map(
          (r, i) => `<circle ${s} stroke-opacity="${0.36 - i * 0.05}" stroke-width="1.5" cx="420" cy="250" r="${r}"/>`,
        )
        .join('')
    case 'leaf':
      return [0, 1, 2, 3, 4, 5]
        .map(
          (i) =>
            `<path ${s} stroke-opacity="${0.3 - i * 0.04}" stroke-width="1.5" d="M300 ${600 - i * 10} C${180 - i * 22} ${470 - i * 30} ${210 - i * 18} ${250 - i * 30} 300 ${150 + i * 6} C${390 + i * 18} ${250 - i * 30} ${420 + i * 22} ${470 - i * 30} 300 ${600 - i * 10}Z"/>`,
        )
        .concat(`<path ${s} stroke-opacity="0.3" d="M300 160 V640"/>`)
        .join('')
    case 'wave':
      return Array.from({ length: 9 }, (_, i) => {
        const y = 170 + i * 46
        return `<path ${s} stroke-opacity="${0.12 + (i % 3) * 0.08}" stroke-width="1.5" d="M40 ${y} C140 ${y - 34} 220 ${y + 34} 300 ${y} S460 ${y - 34} 560 ${y}"/>`
      }).join('')
    case 'grid':
      return Array.from({ length: 11 }, (_, i) => {
        const p = 80 + i * 44
        return `<path ${s} stroke-opacity="0.13" d="M${p} 120 V640 M80 ${p + 40} H520"/>`
      })
        .concat(
          `<rect ${s} stroke-opacity="0.35" stroke-width="2" x="168" y="208" width="264" height="264" transform="rotate(45 300 340)"/>`,
        )
        .join('')
  }
}

export function renderCoverSvg(book: CoverInput, options: { fontFamily?: string } = {}): string {
  const { background, ink, motif: kind } = book.cover
  const font = options.fontFamily ?? "Georgia, 'Times New Roman', serif"
  const lines = wrapTitle(book.title, 16)
  const size = lines.length > 3 ? 46 : 54
  const lineHeight = size * 1.12
  const top = 712 - (lines.length - 1) * lineHeight
  const title = lines
    .map((line, i) => `<tspan x="300" y="${(top + i * lineHeight).toFixed(1)}">${escapeXml(line)}</tspan>`)
    .join('')
  const id = `c${Math.abs([...book.title].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36)}`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${background[0]}"/><stop offset="1" stop-color="${background[1]}"/></linearGradient><linearGradient id="${id}s" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".06" stop-color="#fff" stop-opacity="0"/><stop offset=".09" stop-color="#000" stop-opacity=".12"/><stop offset=".14" stop-color="#000" stop-opacity="0"/></linearGradient><radialGradient id="${id}l" cx=".3" cy=".18" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="600" height="900" fill="url(#${id}g)"/><rect width="600" height="900" fill="url(#${id}l)"/>${motif(kind, ink)}<rect x="30" y="30" width="540" height="840" fill="none" stroke="${ink}" stroke-opacity=".38"/><rect x="40" y="40" width="520" height="820" fill="none" stroke="${ink}" stroke-opacity=".16"/><text fill="${ink}" font-family="${escapeXml(font)}" font-size="${size}" font-weight="500" text-anchor="middle" letter-spacing="-0.5">${title}</text><path d="M270 ${top + (lines.length - 1) * lineHeight + 40} H330" stroke="${ink}" stroke-opacity=".6"/><text x="300" y="812" fill="${ink}" fill-opacity=".8" font-family="${escapeXml(font)}" font-size="19" letter-spacing="4" text-anchor="middle">${escapeXml(book.author.toUpperCase())}</text><rect width="600" height="900" fill="url(#${id}s)"/></svg>`
}
