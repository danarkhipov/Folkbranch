import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { signInMethods } from '@/lib/auth'
import { localLoginAllowed } from '@/lib/local-login'
import { archiveLang, getSetting } from '@/lib/ops/settings'
import { LoginScreen } from '@/components/auth-screens'

export const dynamic = 'force-dynamic'

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (localLoginAllowed(await headers())) redirect('/api/auth/family/local')
  return <LoginScreen lang={archiveLang()} familyName={getSetting('familyName') ?? ''} providers={signInMethods()} error={(await searchParams).error} />
}
