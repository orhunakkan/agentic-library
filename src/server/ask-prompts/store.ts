import '@tanstack/react-start/server-only'
import { type AppliesTo, isAppliesTo, isPromptId, MAX_ASK_PROMPTS } from '~/shared/ask-prompts/prompts'
import type { Db, Pool } from '../db.ts'

export interface PromptRow {
  id: string
  name: string
  appliesTo: AppliesTo
  instruction: string
  position: number
  createdAt: Date
  updatedAt: Date
}

export interface PromptInput {
  name: string
  appliesTo: AppliesTo
  instruction: string
}

interface RawPrompt {
  id: string
  name: string
  applies_to: string
  instruction: string
  position: number
  created_at: Date
  updated_at: Date
}

const NAME_INDEX = 'ask_prompts_user_name_idx'

const isNameClash = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: string }).code === '23505' &&
  (error as { constraint_name?: string }).constraint_name === NAME_INDEX

function toRow(raw: RawPrompt): PromptRow | null {
  if (!isAppliesTo(raw.applies_to)) return null
  return {
    id: raw.id,
    name: raw.name,
    appliesTo: raw.applies_to,
    instruction: raw.instruction,
    position: raw.position,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

const rows = (raws: readonly RawPrompt[]) => raws.map(toRow).filter((r): r is PromptRow => r !== null)

const COLUMNS = 'id, name, applies_to, instruction, position, created_at, updated_at'

export async function listPrompts(db: Db, userId: number): Promise<PromptRow[]> {
  return rows(
    await db<RawPrompt[]>`
      select ${db.unsafe(COLUMNS)} from ask_prompts where user_id = ${userId}
      order by position, created_at, id`,
  )
}

export async function findPrompt(db: Db, userId: number, id: string): Promise<PromptRow | null> {
  if (!isPromptId(id)) return null
  const [raw] = await db<RawPrompt[]>`
    select ${db.unsafe(COLUMNS)} from ask_prompts where id = ${id} and user_id = ${userId}`
  return raw ? toRow(raw) : null
}

export function createPrompt(pool: Pool, userId: number, input: PromptInput): Promise<PromptRow | 'quota' | 'exists'> {
  return pool.begin(async (tx): Promise<PromptRow | 'quota' | 'exists'> => {
    await tx`select id from users where id = ${userId} for update`
    const [count] = await tx<{ n: string; last: number | null }[]>`
      select count(*) as n, max(position) as last from ask_prompts where user_id = ${userId}`
    if (Number(count?.n ?? 0) >= MAX_ASK_PROMPTS) return 'quota'
    const position = (count?.last ?? -1) + 1
    const [raw] = await tx<RawPrompt[]>`
      insert into ask_prompts (user_id, name, applies_to, instruction, position)
      values (${userId}, ${input.name}, ${input.appliesTo}, ${input.instruction}, ${position})
      on conflict (user_id, lower(name)) do nothing
      returning ${tx.unsafe(COLUMNS)}`
    return (raw && toRow(raw)) ?? 'exists'
  })
}

export async function editPrompt(
  db: Db,
  userId: number,
  id: string,
  input: PromptInput,
): Promise<PromptRow | 'missing' | 'exists'> {
  if (!isPromptId(id)) return 'missing'
  try {
    const [raw] = await db<RawPrompt[]>`
      update ask_prompts
      set name = ${input.name}, applies_to = ${input.appliesTo}, instruction = ${input.instruction}, updated_at = now()
      where id = ${id} and user_id = ${userId}
      returning ${db.unsafe(COLUMNS)}`
    return (raw && toRow(raw)) ?? 'missing'
  } catch (error) {
    if (isNameClash(error)) return 'exists'
    throw error
  }
}

export type MoveDirection = 'up' | 'down'

export function movePrompt(
  pool: Pool,
  userId: number,
  id: string,
  direction: MoveDirection,
): Promise<PromptRow[] | 'missing'> {
  if (!isPromptId(id)) return Promise.resolve('missing')
  return pool.begin(async (tx): Promise<PromptRow[] | 'missing'> => {
    await tx`select id from users where id = ${userId} for update`
    const list = await listPrompts(tx, userId)
    const at = list.findIndex((p) => p.id === id)
    const moving = list[at]
    if (!moving) return 'missing'
    const other = list[direction === 'up' ? at - 1 : at + 1]
    if (!other) return list
    const [first, second] = direction === 'up' ? [moving, other] : [other, moving]
    const low = Math.min(moving.position, other.position)
    const high = Math.max(moving.position, other.position, low + 1)
    await tx`update ask_prompts set position = ${low} where id = ${first.id} and user_id = ${userId}`
    await tx`update ask_prompts set position = ${high} where id = ${second.id} and user_id = ${userId}`
    return listPrompts(tx, userId)
  })
}

export async function deletePrompt(db: Db, userId: number, id: string): Promise<true | 'missing'> {
  if (!isPromptId(id)) return 'missing'
  const result = await db`delete from ask_prompts where id = ${id} and user_id = ${userId}`
  return result.count > 0 ? true : 'missing'
}
