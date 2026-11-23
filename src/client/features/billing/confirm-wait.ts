const POLL_EVERY_MS = 2_000
const STILL_CONFIRMING_AFTER_MS = 60_000
const SLOW_POLL_EVERY_MS = 10_000

export function nextPollDelay(elapsed: number): number {
  return elapsed < STILL_CONFIRMING_AFTER_MS ? POLL_EVERY_MS : SLOW_POLL_EVERY_MS
}

export function isStillConfirming(elapsed: number): boolean {
  return elapsed >= STILL_CONFIRMING_AFTER_MS
}
