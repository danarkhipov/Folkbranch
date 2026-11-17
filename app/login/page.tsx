import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { signInMethods } from '@/lib/auth'
import { localLoginAllowed } from '@/lib/local-login'
import { viewerLang } from '@/lib/languages'
import { archiveLang, getSetting } from '@/lib/ops/settings'
import { LoginScreen } from '@/components/auth-screens'

export const dynamic = 'force-dynamic'

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const h = await headers()
  if (localLoginAllowed(h)) redirect('/api/auth/family/local')
  const archive = archiveLang()
  return <LoginScreen lang={viewerLang(h.get('cookie'), h.get('accept-language'), archive)} familyName={getSetting('familyName') ?? ''} providers={signInMethods()} error={(await searchParams).error} />
}
