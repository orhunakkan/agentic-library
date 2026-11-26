export interface PiperPhonemeConfig {
  phoneme_type?: string
  phoneme_id_map: Record<string, number[]>
  vowel_clusters?: string[][]
}

const BOS = '^'
const EOS = '$'
const PAD = '_'
const TERMINATORS = new Set(['.', '!', '?'])

export function splitPhonemes(raw: string, config: PiperPhonemeConfig): string[] {
  const points = [...raw.replace(/\([^)]+\)/g, '').normalize('NFD')]
  const vowelClusters = config.vowel_clusters ?? []
  const clusters = new Set(vowelClusters.map((c) => c.join('')))
  if (clusters.size === 0) return points
  const longest = Math.max(...vowelClusters.map((c) => c.length))
  const out: string[] = []
  for (let i = 0; i < points.length; ) {
    let taken = 1
    for (let n = Math.min(longest, points.length - i); n > 1; n--) {
      if (clusters.has(points.slice(i, i + n).join(''))) {
        taken = n
        break
      }
    }
    out.push(points.slice(i, i + taken).join(''))
    i += taken
  }
  return out
}

export const textPhonemes = (text: string): string[] => [...text.toLowerCase().normalize('NFD')]

export function sentences(phonemes: string[]): string[][] {
  let sentence: string[] = []
  const out = [sentence]
  for (const p of phonemes) {
    sentence.push(p)
    if (TERMINATORS.has(p)) {
      sentence = []
      out.push(sentence)
    }
  }
  return out.map((s) => (s[0] === ' ' ? s.slice(1) : s)).filter((s) => s.some((p) => p.trim() !== ''))
}

export function phonemeIds(phonemes: string[], config: PiperPhonemeConfig): number[] {
  const map = config.phoneme_id_map
  const pad = map[PAD] ?? []
  const ids = [...(map[BOS] ?? []), ...pad]
  for (const p of phonemes) {
    const found = map[p]
    if (found) ids.push(...found, ...pad)
  }
  ids.push(...(map[EOS] ?? []))
  return ids
}
