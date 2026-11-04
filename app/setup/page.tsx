import { redirect } from 'next/navigation'
import { hasUsers } from '@/lib/ops/settings'
import { SetupScreen } from '@/components/auth-screens'
import { setupCode } from '@/lib/setup-code'

export const dynamic = 'force-dynamic'

export default async function Setup({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  if (hasUsers()) redirect('/')
  return <SetupScreen needsCode={!!setupCode()} initialCode={(await searchParams).code ?? ''} />
}
