function fromIsbn10(ten: string): string | null {
  const sum = [...ten].reduce((total, c, i) => total + (c === 'X' ? 10 : Number(c)) * (10 - i), 0)
  if (sum % 11 !== 0) return null
  const twelve = `978${ten.slice(0, 9)}`
  return twelve + checkDigit13(twelve)
}

function checkDigit13(twelve: string): string {
  const sum = [...twelve].reduce((total, c, i) => total + Number(c) * (i % 2 ? 3 : 1), 0)
  return String((10 - (sum % 10)) % 10)
}

export function normalizeIsbn(value: string): string | null {
  const bare = value
    .trim()
    .replace(/^(?:urn:)?isbn(?:-1[03])?:?/i, '')
    .replace(/[\s-]/g, '')
    .toUpperCase()
  if (/^\d{9}[\dX]$/.test(bare)) return fromIsbn10(bare)
  if (/^97[89]\d{10}$/.test(bare)) return checkDigit13(bare.slice(0, 12)) === bare[12] ? bare : null
  return null
}

export const isBadIsbn = (isbn: string | null | undefined) =>
  Boolean(isbn?.trim()) && normalizeIsbn(isbn ?? '') === null
