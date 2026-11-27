import { describe, expect, it } from 'vitest'
import { checkPrompt } from '~/shared/ask-prompts/prompts.ts'
import { STARTER_PROMPTS, starterKey } from '~/shared/ask-prompts/starters.ts'

describe('STARTER_PROMPTS', () => {
  it('each passes checkPrompt unchanged', () => {
    for (const starter of STARTER_PROMPTS) {
      expect(checkPrompt(starter)).toEqual({
        ok: true,
        prompt: { name: starter.name, appliesTo: starter.appliesTo, instruction: starter.instruction },
      })
    }
  })

  it('has names unique ignoring case', () => {
    expect(new Set(STARTER_PROMPTS.map((s) => s.name.toLowerCase())).size).toBe(STARTER_PROMPTS.length)
  })

  it('has two of each kind', () => {
    expect(STARTER_PROMPTS.filter((s) => s.appliesTo === 'pages')).toHaveLength(2)
    expect(STARTER_PROMPTS.filter((s) => s.appliesTo === 'passage')).toHaveLength(2)
  })

  it('keys each one by a slug of its name', () => {
    for (const starter of STARTER_PROMPTS) expect(starter.key).toBe(starterKey(starter.name))
  })
})

describe('starterKey', () => {
  it('lower-cases, drops apostrophes and hyphenates the rest', () => {
    expect(starterKey("Who's who so far")).toBe('whos-who-so-far')
    expect(starterKey('  A / B ’c ')).toBe('a-b-c')
  })
})
