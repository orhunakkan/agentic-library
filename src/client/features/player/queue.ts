export function neighbours<T extends { id: string }>(episodes: readonly T[], currentId: string) {
  const index = episodes.findIndex((e) => e.id === currentId)
  return { prev: index > 0 ? episodes[index - 1] : undefined, next: index >= 0 ? episodes[index + 1] : undefined }
}

const SPEEDS: readonly number[] = [1, 1.25, 1.5, 1.75, 2, 0.75]

export function nextSpeed(speed: number): number {
  const index = SPEEDS.indexOf(speed)
  return index < 0 ? 1 : (SPEEDS[(index + 1) % SPEEDS.length] ?? 1)
}
