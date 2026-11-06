import { findInvite, archiveLang, getSetting, isRecoveryToken } from '@/lib/ops/settings'
import { InviteScreen } from '@/components/auth-screens'

export const dynamic = 'force-dynamic'

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invite = findInvite(token)
  return <InviteScreen token={token} valid={!!invite || isRecoveryToken(token)} name={invite?.name ?? ''} lang={archiveLang()} familyName={getSetting('familyName') ?? ''} />
}
