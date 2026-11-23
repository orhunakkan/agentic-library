import { describe, expect, it } from 'vitest'
import { AI_MODELS, aiModelName, DEFAULT_AI_MODEL, isAiModel, resolveAiModel } from './ai-models'

describe('ai models', () => {
  it('offers Opus 5.5 (the default), Sonnet 5.5 and Haiku 5.5', () => {
    expect(AI_MODELS.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])
    expect(DEFAULT_AI_MODEL).toBe('claude-opus-5-5')
  })

  it('reads null and unknown stored values as the default', () => {
    expect(resolveAiModel(null)).toBe('claude-opus-5-5')
    expect(resolveAiModel(undefined)).toBe('claude-opus-5-5')
    expect(resolveAiModel('claude-retired-1')).toBe('claude-opus-5-5')
    expect(resolveAiModel('claude-haiku-5-5')).toBe('claude-haiku-5-5')
  })

  it('accepts only listed ids', () => {
    expect(isAiModel('claude-sonnet-5-5')).toBe(true)
    expect(isAiModel('CLAUDE-SONNET-5-5')).toBe(false)
    expect(isAiModel(42)).toBe(false)
  })

  it('names a model for display', () => {
    expect(aiModelName('claude-sonnet-5-5')).toBe('Claude Sonnet 5.5')
  })
})
