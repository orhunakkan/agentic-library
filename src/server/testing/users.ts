import type { Db } from '../db.ts'
import { createUser, type Role, type User } from '../users.ts'

export function testUser(db: Db, username: string, passwordHash: string, role: Role = 'member'): Promise<User> {
  return createUser(db, username, passwordHash, role)
}
