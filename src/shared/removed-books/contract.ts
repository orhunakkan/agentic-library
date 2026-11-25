export type RemovedBookErrorCode = 'signed_out' | 'not_found' | 'invalid' | 'failed'

export type RemovedBooksState = { state: 'signed_out' } | { state: 'unavailable' } | { state: 'ready'; books: string[] }
