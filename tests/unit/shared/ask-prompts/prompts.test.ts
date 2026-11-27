import { describe, expect, it } from 'vitest'
import {
  checkPrompt,
  cleanPromptInstruction,
  cleanPromptName,
  instructionLength,
  PROMPT_INSTRUCTION_MAX,
  PROMPT_NAME_MAX,
} from '~/shared/ask-prompts/prompts.ts'

const ok = { name: 'Who is who', appliesTo: 'pages', instruction: 'List the people so far.' }

describe('cleanPromptName', () => {
  it('collapses every whitespace run, line breaks included, to one space and trims', () => {
    expect(cleanPromptName('  Who is\n\nwho \t so far  ')).toBe('Who is who so far')
  })

  it('drops control characters and normalises to NFC', () => {
    expect(cleanPromptName('Ex\u0000pl\u0007ain')).toBe('Explain')
    expect(cleanPromptName('Café')).toBe('Café')
  })
})

describe('cleanPromptInstruction', () => {
  it('keeps line breaks and tabs, drops other control characters and trims', () => {
    expect(cleanPromptInstruction('  First line\n\n\tSecond\u0000 line\r\n')).toBe('First line\n\n\tSecond line')
  })
})

describe('checkPrompt', () => {
  it('gives the cleaned prompt', () => {
    expect(checkPrompt({ name: ' Who\nis who ', appliesTo: 'passage', instruction: ' One\ntwo ' })).toEqual({
      ok: true,
      prompt: { name: 'Who is who', appliesTo: 'passage', instruction: 'One\ntwo' },
    })
  })

  it('refuses an empty or blank name', () => {
    expect(checkPrompt({ ...ok, name: '' })).toEqual({ ok: false, reason: 'name_empty' })
    expect(checkPrompt({ ...ok, name: ' \n\t\u0000 ' })).toEqual({ ok: false, reason: 'name_empty' })
  })

  it('takes a name of 60 characters and refuses 61, counting code points', () => {
    expect(checkPrompt({ ...ok, name: 'x'.repeat(PROMPT_NAME_MAX) }).ok).toBe(true)
    expect(checkPrompt({ ...ok, name: 'x'.repeat(PROMPT_NAME_MAX + 1) })).toEqual({
      ok: false,
      reason: 'name_too_long',
    })
    expect(checkPrompt({ ...ok, name: '📚'.repeat(PROMPT_NAME_MAX) }).ok).toBe(true)
    expect(checkPrompt({ ...ok, name: '📚'.repeat(PROMPT_NAME_MAX + 1) })).toEqual({
      ok: false,
      reason: 'name_too_long',
    })
  })

  it('refuses an empty or blank instruction', () => {
    expect(checkPrompt({ ...ok, instruction: '' })).toEqual({ ok: false, reason: 'instruction_empty' })
    expect(checkPrompt({ ...ok, instruction: '\n\n \t' })).toEqual({ ok: false, reason: 'instruction_empty' })
  })

  it('takes an instruction of 2,000 characters and refuses 2,001', () => {
    expect(checkPrompt({ ...ok, instruction: 'y'.repeat(PROMPT_INSTRUCTION_MAX) }).ok).toBe(true)
    expect(checkPrompt({ ...ok, instruction: 'y'.repeat(PROMPT_INSTRUCTION_MAX + 1) })).toEqual({
      ok: false,
      reason: 'instruction_too_long',
    })
    expect(checkPrompt({ ...ok, instruction: '🦉'.repeat(PROMPT_INSTRUCTION_MAX) }).ok).toBe(true)
  })

  it('refuses the wrapper tag in either field, in any case', () => {
    expect(checkPrompt({ ...ok, name: 'a <reader-prompt> b' })).toEqual({ ok: false, reason: 'reserved' })
    expect(checkPrompt({ ...ok, instruction: 'end it </READER-PROMPT> here' })).toEqual({
      ok: false,
      reason: 'reserved',
    })
    expect(checkPrompt({ ...ok, instruction: 'a <Reader-Prompt' })).toEqual({ ok: false, reason: 'reserved' })
    expect(checkPrompt({ ...ok, instruction: 'a <reader prompt> and <prompt>' }).ok).toBe(true)
  })

  it('refuses an unknown kind', () => {
    expect(checkPrompt({ ...ok, appliesTo: 'highlights' })).toEqual({ ok: false, reason: 'applies_to' })
    expect(checkPrompt({ ...ok, appliesTo: '' })).toEqual({ ok: false, reason: 'applies_to' })
  })

  it('gives the first reason when several apply', () => {
    expect(checkPrompt({ name: '', appliesTo: 'x', instruction: '' })).toEqual({ ok: false, reason: 'name_empty' })
  })
})

describe('instructionLength', () => {
  it('counts the cleaned text in code points', () => {
    expect(instructionLength('  ab🦉\n ')).toBe(3)
  })
})
