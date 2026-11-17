import { headers } from 'next/headers'
import { ShareScreen } from '@/components/auth-screens'
import { viewerLang } from '@/lib/languages'
import { archiveLang } from '@/lib/ops/settings'
import { shareInfo } from '@/lib/ops/share'

export const dynamic = 'force-dynamic'

/** Says nothing about whose family this is: the link may be read by a messenger before a person. */
export default async function Share({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const h = await headers()
  const info = shareInfo(token)
  return <ShareScreen token={token} valid={!!info} needsPassword={!!info?.needsPassword} lang={viewerLang(h.get('cookie'), h.get('accept-language'), archiveLang())} />
}
