import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuth, providers } from '@/lib/auth'
import { getSetting, hasUsers, ownCard } from '@/lib/ops/settings'
import { assistantState } from '@/lib/agent/agent'
import { FamilyApp } from '@/components/family-app'
import type { Lang, Me, Role } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function Home() {
  if (!hasUsers()) redirect('/setup')
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const u = session.user as typeof session.user & { role: Role; personId: string | null }
  const me: Me = { id: u.id, name: u.name, role: u.role, personId: ownCard(u.personId) }
  return <FamilyApp assistant={assistantState({ userId: me.id, name: me.name, role: me.role, personId: me.personId })} me={me} lang={(getSetting('language') as Lang) ?? 'ru'} familyName={getSetting('familyName') ?? ''} providers={providers()} />
}
