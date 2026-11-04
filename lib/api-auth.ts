import { getAuth } from './auth'
import { ownCard } from './ops/settings'
import { actorFromToken } from './ops/tokens'
import type { Actor } from './ops/core'
import type { Role } from './types'

const bearer = (headers: Headers) => headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]

export const hasBearer = (headers: Headers) => !!headers.get('authorization')

export function tokenActor(headers: Headers): Actor | null {
  const t = bearer(headers)
  return t ? actorFromToken(t) : null
}

/** A presented token decides alone: a bad one never falls back to the session cookie. */
export async function getActor(headers: Headers): Promise<Actor | null> {
  if (hasBearer(headers)) return tokenActor(headers)
  const session = await getAuth().api.getSession({ headers })
  if (!session) return null
  const u = session.user as typeof session.user & { role: Role; personId: string | null }
  return { userId: u.id, name: u.name, role: u.role, personId: ownCard(u.personId) }
}
