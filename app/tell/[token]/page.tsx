import { headers } from 'next/headers'
import { TellScreen } from '@/components/tell-screen'
import { viewerLang } from '@/lib/languages'
import { archiveLang } from '@/lib/ops/settings'
import { requestInfo } from '@/lib/ops/story-requests'

export const dynamic = 'force-dynamic'

export default async function Tell({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const h = await headers()
  return <TellScreen token={token} info={requestInfo(token)} lang={viewerLang(h.get('cookie'), h.get('accept-language'), archiveLang())} />
}
