import { headers } from 'next/headers'
import { findInvite, archiveLang, getSetting, isRecoveryToken } from '@/lib/ops/settings'
import { viewerLang } from '@/lib/languages'
import { InviteScreen } from '@/components/auth-screens'

export const dynamic = 'force-dynamic'

export default async function Invite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ go?: string }> }) {
  const { token } = await params
  const { go } = await searchParams
  const h = await headers()
  const archive = archiveLang()
  const invite = findInvite(token)
  return <InviteScreen token={token} valid={!!invite || isRecoveryToken(token)} name={invite?.name ?? ''} lang={viewerLang(h.get('cookie'), h.get('accept-language'), archive)} familyName={getSetting('familyName') ?? ''} auto={go === '1' && invite?.role === 'owner' && invite.createdBy === 'cli'} />
}
