import { describe, expect, it } from 'vitest'
import type { PromptRow } from './store'
import { toPromptChoice, toPromptView } from './view'

const row: PromptRow = {
  id: '6f1c0000-0000-4000-8000-000000000000',
  name: 'Who is who',
  appliesTo: 'pages',
  instruction: 'List them.',
  position: 3,
  createdAt: new Date('2026-11-21T10:00:00Z'),
  updatedAt: new Date('2026-11-21T11:00:00Z'),
}

describe('the views', () => {
  it('give the page the instruction and never the position or times', () => {
    expect(toPromptView(row)).toEqual({ id: row.id, name: 'Who is who', appliesTo: 'pages', instruction: 'List them.' })
  })

  it('give the Ask panel only the id, name and kind', () => {
    expect(toPromptChoice(row)).toEqual({ id: row.id, name: 'Who is who', appliesTo: 'pages' })
  })
})
