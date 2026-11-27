import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import { Providers } from '@/components/providers'
import { viewerLang, langDef } from '@/lib/languages'
import { archiveLang } from '@/lib/ops/settings'
import { demoOn } from '@/lib/demo-mode'
import { DemoShell } from '@/components/demo-banner'

export const metadata: Metadata = { title: 'Folkbranch', applicationName: 'Folkbranch', robots: { index: false, follow: false } }
export const viewport: Viewport = { themeColor: '#f7f3ea' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const archive = archiveLang()
  const lang = viewerLang(h.get('cookie'), h.get('accept-language'), archive)
  // The archive keeps its own language for its data, whatever the viewer reads the interface in.
  return (
    <html lang={lang} dir={langDef(lang).dir} data-archive-lang={archive}>
      <body><Providers>{demoOn() ? <DemoShell lang={lang}>{children}</DemoShell> : children}</Providers></body>
    </html>
  )
}
