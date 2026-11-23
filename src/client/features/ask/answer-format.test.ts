import { describe, expect, it } from 'vitest'
import {
  citationMarker as cite,
  cleanModelText,
  parseAnswer,
  parseInlines,
  plainAnswer,
  readableCitation,
} from './answer-format'

describe('parseInlines', () => {
  it('reads inline code, bold and citation markers', () => {
    expect(parseInlines(`Use \`let\` for **bindings**${cite(0)}, mostly.`)).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'code', text: 'let' },
      { kind: 'text', text: ' for ' },
      { kind: 'strong', text: 'bindings' },
      { kind: 'cite', index: 0 },
      { kind: 'text', text: ', mostly.' },
    ])
  })

  it('treats everything inside a code span as code', () => {
    expect(parseInlines('`a **b** <i>`')).toEqual([{ kind: 'code', text: 'a **b** <i>' }])
  })

  it('leaves markup as text: nothing is HTML', () => {
    expect(parseInlines('<img src=x onerror=alert(1)> [link](https://evil.example)')).toEqual([
      { kind: 'text', text: '<img src=x onerror=alert(1)> [link](https://evil.example)' },
    ])
  })
})

describe('parseAnswer', () => {
  it('splits paragraphs on blank lines and joins wrapped lines', () => {
    expect(parseAnswer('One\nline.\n\nTwo.')).toEqual([
      { kind: 'p', inlines: [{ kind: 'text', text: 'One line.' }] },
      { kind: 'p', inlines: [{ kind: 'text', text: 'Two.' }] },
    ])
  })

  it('reads bulleted and numbered lists, with continuation lines', () => {
    expect(parseAnswer('Steps:\n1. First\n2. Second\n   goes on\n\n- a\n* b')).toEqual([
      { kind: 'p', inlines: [{ kind: 'text', text: 'Steps:' }] },
      {
        kind: 'list',
        ordered: true,
        items: [[{ kind: 'text', text: 'First' }], [{ kind: 'text', text: 'Second goes on' }]],
      },
      { kind: 'list', ordered: false, items: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]] },
    ])
  })

  it('keeps fenced code exactly, and moves citations inside it to after the block', () => {
    expect(parseAnswer(`For example:\n\n\`\`\`js\nconst x = 1\n  if (a < b) {}${cite(2)}\n\`\`\`\nAfter.`)).toEqual([
      { kind: 'p', inlines: [{ kind: 'text', text: 'For example:' }] },
      { kind: 'code', language: 'js', text: 'const x = 1\n  if (a < b) {}' },
      { kind: 'p', inlines: [{ kind: 'cite', index: 2 }] },
      { kind: 'p', inlines: [{ kind: 'text', text: 'After.' }] },
    ])
  })

  it('shows an unclosed fence as code while the answer streams', () => {
    expect(parseAnswer('Look:\n```\nlet a')).toEqual([
      { kind: 'p', inlines: [{ kind: 'text', text: 'Look:' }] },
      { kind: 'code', language: '', text: 'let a' },
    ])
  })

  it('reads headings as paragraphs', () => {
    expect(parseAnswer('## Closures\nText')).toEqual([
      { kind: 'p', inlines: [{ kind: 'text', text: 'Closures Text' }] },
    ])
  })
})

describe('markers', () => {
  it('are removed for Copy and history, and stripped from model text so it cannot place a chip', () => {
    expect(plainAnswer(`A${cite(0)} b${cite(12)}.`)).toBe('A b.')
    expect(cleanModelText(`x${String.fromCharCode(0xe000)}3${String.fromCharCode(0xe001)}y`)).toBe('x3y')
  })
})

describe('readableCitation', () => {
  it('shows a passage as the book reads, without the code marks added for the model', () => {
    expect(readableCitation('Both `function` forms.\n\n```\nlet a = 1\n```')).toBe('Both function forms.\n\nlet a = 1')
  })
})
