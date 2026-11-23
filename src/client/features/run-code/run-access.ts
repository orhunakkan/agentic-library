import { canUse, type Plan } from '~/shared/plans/plans'

export type RunAccess = 'pro' | 'free' | 'signed_out'

export function runAccess(viewer: { plan: Plan } | null | undefined): RunAccess {
  if (!viewer) return 'signed_out'
  return canUse(viewer.plan, 'run') ? 'pro' : 'free'
}
