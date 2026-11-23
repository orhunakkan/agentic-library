export const PRO_PRICE = { monthly: 4.99, yearly: 39 } as const

export const FOUNDING_PRICE = 29

export function formatPrice(dollars: number): string {
  const cents = Math.round(dollars * 100)
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`
}

export function yearlySavingPercent(price: { monthly: number; yearly: number } = PRO_PRICE): number {
  const twelve = price.monthly * 12
  if (twelve <= 0) return 0
  return Math.max(0, Math.round(((twelve - price.yearly) / twelve) * 100))
}
