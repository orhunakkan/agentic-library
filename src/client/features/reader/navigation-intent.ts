import type { Turn } from './Page'

export interface Intent {
  turn: Turn
  turning: boolean
  scrolledTo: string | null
}

export type IntentEvent =
  | { type: 'turned'; turn: Turn }
  | { type: 'turnFailed' }
  | { type: 'voiceTurned' }
  | { type: 'voiceTurnFailed' }
  | { type: 'scrolledTo'; href: string }
  | { type: 'scrollFailed'; href: string }
  | { type: 'arrived'; href: string }

export const IDLE: Intent = { turn: 'fade', turning: false, scrolledTo: null }

export function next(intent: Intent, event: IntentEvent): Intent {
  switch (event.type) {
    case 'turned':
      return { ...intent, turn: event.turn, turning: true }
    case 'turnFailed':
      return { ...intent, turn: 'fade', turning: false }
    case 'voiceTurned':
      return { ...intent, turn: 'forward' }
    case 'voiceTurnFailed':
      return { ...intent, turn: 'fade' }
    case 'scrolledTo':
      return { ...intent, scrolledTo: event.href }
    case 'scrollFailed':
      return intent.scrolledTo === event.href ? { ...intent, scrolledTo: null } : intent
    case 'arrived':
      return event.href === intent.scrolledTo ? { ...intent, scrolledTo: null } : IDLE
  }
}

export interface Arrival {
  followedScroll: boolean
  turn: Turn | null
  closeOverlays: boolean
  column: 'leave' | 'voice' | 'place'
}

export function arrival(intent: Intent, href: string, voicePlaces: boolean): Arrival {
  if (intent.scrolledTo === href) return { followedScroll: true, turn: null, closeOverlays: false, column: 'leave' }
  return { followedScroll: false, turn: intent.turn, closeOverlays: true, column: voicePlaces ? 'voice' : 'place' }
}

export const canTurn = (intent: Intent): boolean => !intent.turning

export const showsLoadingBar = (intent: Intent): boolean => intent.scrolledTo === null

export interface ColumnIntent {
  follow(href: string): void
  arrival(href: string): Arrival['column']
}
