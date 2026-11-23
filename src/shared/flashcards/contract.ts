export interface FlashcardView {
  id: string
  front: string
  back: string
  source: { pageHref: string; label: string } | null
  box: number
  dueAt: string
  createdAt: string
}

export interface FlashcardBookSummary {
  slug: string
  title: string
  removed: boolean
  cards: number
  due: number
  nextDueAt: string
  activeAt: string
}

export interface BookFlashcards {
  book: { slug: string; title: string; href: string }
  cards: FlashcardView[]
  due: FlashcardView[]
}

export interface FlashcardBookCount {
  slug: string
  title: string
  cards: number
}
