import '@tanstack/react-start/server-only'
import type { AdminProblem } from '~/shared/admin/users'
import { type Gate, signedInEndpoints } from '../signed-in.ts'

const MAX_BODY_BYTES = 1024

export const admins = signedInEndpoints<AdminProblem>({ maxBytes: MAX_BODY_BYTES })

export const { fail } = admins

export const adminOnly = ({ session }: Gate) => (session.role === 'admin' ? undefined : fail(404, 'not_found'))
