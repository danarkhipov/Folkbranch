import { providers } from '@/lib/auth'
import { archiveLang, getSetting } from '@/lib/ops/settings'
import { LoginScreen } from '@/components/auth-screens'

export const dynamic = 'force-dynamic'

export default function Login() {
  return <LoginScreen lang={archiveLang()} familyName={getSetting('familyName') ?? ''} providers={providers()} />
}
