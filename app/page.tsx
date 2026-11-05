import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { guestActor } from '@/lib/api-auth'
import { getAuth, providers } from '@/lib/auth'
import { getSetting, hasUsers, ownCard } from '@/lib/ops/settings'
import { assistantState } from '@/lib/agent/agent'
import { FamilyApp } from '@/components/family-app'
import type { Lang, Me, Role } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function Home() {
  if (!hasUsers()) redirect('/setup')
  const h = await headers()
  const session = await getAuth().api.getSession({ headers: h })
  if (!session) {
    const guest = guestActor(h)
    if (!guest) redirect('/login')
    return <FamilyApp assistant={{ ready: false, reason: 'readers', canFix: false }} me={{ id: guest.userId, name: guest.name, role: 'reader', personId: null, guest: true }} lang={(getSetting('language') as Lang) ?? 'ru'} familyName={getSetting('familyName') ?? ''} providers={{ google: false, yandex: false }} />
  }
  const u = session.user as typeof session.user & { role: Role; personId: string | null }
  const me: Me = { id: u.id, name: u.name, role: u.role, personId: ownCard(u.personId) }
  return <FamilyApp assistant={assistantState({ userId: me.id, name: me.name, role: me.role, personId: me.personId })} me={me} lang={(getSetting('language') as Lang) ?? 'ru'} familyName={getSetting('familyName') ?? ''} providers={providers()} />
}
