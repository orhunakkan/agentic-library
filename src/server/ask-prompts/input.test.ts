import { describe, expect, it } from 'vitest'
import { isDeleteBody, isPromptId, parseNewPrompt, parsePromptChange } from './input'

const fields = { name: ' Who is\nwho ', appliesTo: 'pages', instruction: 'List them.\nOne line each.' }
const cleaned = { name: 'Who is who', appliesTo: 'pages', instruction: 'List them.\nOne line each.' }

describe('parseNewPrompt', () => {
  it('takes exactly a name, a kind and an instruction, cleaned', () => {
    expect(parseNewPrompt(fields)).toEqual(cleaned)
    expect(parseNewPrompt({ ...fields, appliesTo: 'passage' })).toEqual({ ...cleaned, appliesTo: 'passage' })
  })

  it('gives the reason for a right shape with a wrong value', () => {
    expect(parseNewPrompt({ ...fields, name: '' })).toEqual({ reason: 'name_empty' })
    expect(parseNewPrompt({ ...fields, instruction: '<reader-prompt>' })).toEqual({ reason: 'reserved' })
    expect(parseNewPrompt({ ...fields, appliesTo: 'book' })).toEqual({ reason: 'applies_to' })
  })

  it('refuses a wrong shape', () => {
    for (const bad of [
      null,
      'text',
      [],
      { ...fields, extra: 1 },
      { ...fields, intent: 'edit' },
      { name: 'x', appliesTo: 'pages' },
      { ...fields, name: 5 },
      { ...fields, appliesTo: null },
      { ...fields, instruction: ['x'] },
    ]) {
      expect(parseNewPrompt(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('parsePromptChange', () => {
  it('reads each intent', () => {
    expect(parsePromptChange({ intent: 'edit', ...fields })).toEqual({ intent: 'edit', ...cleaned })
    expect(parsePromptChange({ intent: 'move', direction: 'up' })).toEqual({ intent: 'move', direction: 'up' })
    expect(parsePromptChange({ intent: 'move', direction: 'down' })).toEqual({ intent: 'move', direction: 'down' })
    expect(parsePromptChange({ intent: 'delete' })).toEqual({ intent: 'delete' })
  })

  it('gives an edit’s reason', () => {
    expect(parsePromptChange({ intent: 'edit', ...fields, instruction: ' ' })).toEqual({ reason: 'instruction_empty' })
  })

  it('refuses anything else', () => {
    for (const bad of [
      null,
      [],
      {},
      fields,
      { intent: 'rename', name: 'x' },
      { intent: 'edit', name: 'x' },
      { intent: 'edit', ...fields, direction: 'up' },
      { intent: 'move' },
      { intent: 'move', direction: 'left' },
      { intent: 'move', direction: 'up', extra: 1 },
      { intent: 'delete', extra: 1 },
      { delete: true },
    ]) {
      expect(parsePromptChange(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('isDeleteBody', () => {
  it('is exactly { intent: "delete" }', () => {
    expect(isDeleteBody({ intent: 'delete' })).toBe(true)
    expect(isDeleteBody({ intent: 'delete', name: 'x' })).toBe(false)
    expect(isDeleteBody({ intent: 'edit' })).toBe(false)
    expect(isDeleteBody(null)).toBe(false)
  })
})

describe('isPromptId', () => {
  it('takes a lower-case UUID only', () => {
    expect(isPromptId('6f1c0000-0000-4000-8000-000000000000')).toBe(true)
    expect(isPromptId('6F1C0000-0000-4000-8000-000000000000')).toBe(false)
    expect(isPromptId('6f1c0000-0000-4000-8000-00000000000')).toBe(false)
    expect(isPromptId('new')).toBe(false)
    expect(isPromptId(42)).toBe(false)
  })
})
