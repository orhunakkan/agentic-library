import type { SpokenWord } from './cloud.ts'

export interface Alignment {
  characters: string[]
  starts: number[]
  ends: number[]
}

export interface SayMap {
  say: string
  offsets: number[]
}

const SPACE = /\s/

export function sayMap(pageText: string, start: number, end: number): SayMap {
  let say = ''
  const offsets: number[] = []
  let space = -1
  for (let i = start; i < end; i++) {
    const character = pageText[i] ?? ''
    if (SPACE.test(character)) {
      if (say && space < 0) space = i
      continue
    }
    if (space >= 0) {
      say += ' '
      offsets.push(space)
      space = -1
    }
    say += character
    offsets.push(i)
  }
  return { say, offsets }
}

export function wordsFrom(map: SayMap, alignment: Alignment | null): SpokenWord[] {
  if (!alignment || alignment.characters.join('') !== map.say) return []
  const entry: number[] = []
  alignment.characters.forEach((c, k) => {
    for (let n = 0; n < c.length; n++) entry.push(k)
  })
  const ms = (seconds: number | undefined) => Math.max(0, Math.round((seconds ?? 0) * 1000))
  const words: SpokenWord[] = []
  for (const m of map.say.matchAll(/\S+/g)) {
    const first = m.index
    const last = m.index + m[0].length - 1
    const start = map.offsets[first]
    const end = map.offsets[last]
    if (start === undefined || end === undefined) continue
    words.push({
      start,
      end: end + 1,
      t0: ms(alignment.starts[entry[first] ?? 0]),
      t1: ms(alignment.ends[entry[last] ?? 0]),
    })
  }
  return words
}
