export function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso)
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

const isDue = (iso: string, now: Date) => new Date(iso).getTime() <= now.getTime()

export const dueLabel = (iso: string, now: Date) => (isDue(iso, now) ? 'Due now' : `Next review ${dayLabel(iso, now)}`)

const cards = (n: number) => `${n.toLocaleString('en-GB')} ${n === 1 ? 'card' : 'cards'}`

export function bookLine(book: { cards: number; due: number; nextDueAt: string }, now: Date): string {
  return book.due > 0
    ? `${cards(book.cards)} · ${book.due.toLocaleString('en-GB')} due`
    : `${cards(book.cards)} · next due ${dayLabel(book.nextDueAt, now)}`
}

export function nextDueLine(nextDueAt: string | null, now: Date, ended: boolean): string {
  const lead = ended ? 'Done for now. ' : 'Nothing due. '
  if (nextDueAt === null) return ended ? `${lead}You’ve reviewed every card.` : 'No cards in this book yet.'
  return `${lead}Next card due on ${dayLabel(nextDueAt, now)}.`
}
