import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { providers } from '@/lib/auth'
import { localLoginAllowed } from '@/lib/local-login'
import { archiveLang, getSetting } from '@/lib/ops/settings'
import { LoginScreen } from '@/components/auth-screens'

export const dynamic = 'force-dynamic'

export default async function Login() {
  if (localLoginAllowed((await headers()).get('host'))) redirect('/api/auth/family/local')
  return <LoginScreen lang={archiveLang()} familyName={getSetting('familyName') ?? ''} providers={providers()} />
}
