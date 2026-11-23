const SPECIAL: Record<string, string> = { ı: 'i', İ: 'i', ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ł: 'l' }

export function foldText(value: string): string {
  return value
    .replace(/[ıİßæœøđł]/g, (ch) => SPECIAL[ch] ?? ch)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchesQuery(query: string, fields: readonly string[]): boolean {
  const words = foldText(query).split(' ').filter(Boolean)
  if (words.length === 0) return true
  const haystack = fields.map(foldText).join(' \u0000 ')
  return words.every((word) => haystack.includes(word))
}
