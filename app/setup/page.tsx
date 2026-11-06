import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { addressProblem } from '@/lib/ops/setup-status'
import { hasUsers } from '@/lib/ops/settings'
import { SetupScreen } from '@/components/auth-screens'
import { langFromHeader } from '@/lib/i18n'
import { setupCode } from '@/lib/setup-code'

export const dynamic = 'force-dynamic'

export default async function Setup({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  if (hasUsers()) redirect('/')
  const h = await headers()
  return <SetupScreen needsCode={!!setupCode()} initialCode={(await searchParams).code ?? ''} initialLang={langFromHeader(h.get('accept-language'))} wrongAddress={addressProblem(h)} />
}
