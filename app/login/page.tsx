import { providers } from '@/lib/auth'
import { getSetting } from '@/lib/ops/settings'
import { LoginScreen } from '@/components/auth-screens'
import type { Lang } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default function Login() {
  return <LoginScreen lang={(getSetting('language') as Lang) ?? 'ru'} familyName={getSetting('familyName') ?? ''} providers={providers()} />
}
