export type PickToken = number & { readonly __pickToken: unique symbol }

export interface LatestPick {
  start(): PickToken
  current(): PickToken
  isCurrent(pick: PickToken): boolean
  invalidate(): void
}

export function latestPick(): LatestPick {
  let latest = 0
  return {
    start: () => ++latest as PickToken,
    current: () => latest as PickToken,
    isCurrent: (pick) => pick === latest,
    invalidate: () => {
      latest++
    },
  }
}
