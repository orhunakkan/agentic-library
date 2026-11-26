import type { Viewer } from '~/server/auth'

export type RunAccess = 'signed_in' | 'signed_out'

/** Code runs in the reader's own browser, so any signed-in reader can run it. */
export function runAccess(viewer: Viewer | null | undefined): RunAccess {
  return viewer ? 'signed_in' : 'signed_out'
}
