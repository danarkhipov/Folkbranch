import { redirect } from 'next/navigation'
import { hasUsers } from '@/lib/ops/settings'
import { SetupScreen } from '@/components/auth-screens'

export const dynamic = 'force-dynamic'

export default function Setup() {
  if (hasUsers()) redirect('/')
  return <SetupScreen needsCode={!!process.env.SETUP_TOKEN} />
}
