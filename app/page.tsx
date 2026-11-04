import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuth, providers } from '@/lib/auth'
import { getSetting, hasUsers } from '@/lib/ops/settings'
import { FamilyApp } from '@/components/family-app'
import type { Lang, Me, Role } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function Home() {
  if (!hasUsers()) redirect('/setup')
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const u = session.user as typeof session.user & { role: Role; personId: string | null }
  const me: Me = { id: u.id, name: u.name, role: u.role, personId: u.personId ?? null }
  return <FamilyApp me={me} lang={(getSetting('language') as Lang) ?? 'ru'} familyName={getSetting('familyName') ?? ''} providers={providers()} />
}
