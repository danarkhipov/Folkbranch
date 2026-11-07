import { TellScreen } from '@/components/tell-screen'
import { archiveLang } from '@/lib/ops/settings'
import { requestInfo } from '@/lib/ops/story-requests'

export const dynamic = 'force-dynamic'

export default async function Tell({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <TellScreen token={token} info={requestInfo(token)} lang={archiveLang()} />
}
