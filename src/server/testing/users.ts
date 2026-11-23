import type { Plan } from '../../shared/plans/plans.ts'
import type { Db } from '../db.ts'
import { createUser, type Role, type User } from '../users.ts'

export async function testUser(
  db: Db,
  username: string,
  passwordHash: string,
  role: Role = 'member',
  { plan = 'pro' }: { plan?: Plan } = {},
): Promise<User> {
  const user = await createUser(db, username, passwordHash, role)
  if (plan === 'pro' && role === 'member') await db`update users set pro_granted_at = now() where id = ${user.id}`
  return user
}
