import { describe, expect, it } from 'vitest'
import {
  AI_MODELS,
  aiModelName,
  canStudyWith,
  DEFAULT_AI_MODEL,
  isAiModel,
  providerName,
  providerOf,
  resolveAiModel,
} from './ai-models'

describe('ai models', () => {
  it('offers Opus 5.5 (the default), Sonnet 5.5 and Haiku 5.5, then three GPT models', () => {
    expect(AI_MODELS.map((m) => m.id)).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'gpt-6.2-astra',
      'gpt-6.1-terra',
      'gpt-6-luna',
    ])
    expect(DEFAULT_AI_MODEL).toBe('claude-opus-5-5')
  })

  it('says which provider serves each model, and so which key it needs', () => {
    expect(providerOf('claude-sonnet-5-5')).toBe('anthropic')
    expect(providerOf('gpt-6.1-terra')).toBe('openai')
    expect(AI_MODELS.filter((m) => m.provider === 'openai').every((m) => m.id.startsWith('gpt-'))).toBe(true)
    expect(providerName('openai')).toBe('OpenAI')
    expect(providerName('anthropic')).toBe('Anthropic')
  })

  it('makes quizzes and flashcards only with models that cite pages', () => {
    expect(canStudyWith('claude-haiku-5-5')).toBe(true)
    expect(canStudyWith('gpt-6.2-astra')).toBe(false)
  })

  it('reads a GPT model as stored, like a Claude one', () => {
    expect(resolveAiModel('gpt-6-luna')).toBe('gpt-6-luna')
    expect(aiModelName('gpt-6.2-astra')).toBe('GPT-6.2 Astra')
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
