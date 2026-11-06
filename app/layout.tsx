import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from '@/components/providers'

export const metadata: Metadata = { title: 'Folkbranch', applicationName: 'Folkbranch', robots: { index: false, follow: false } }
export const viewport: Viewport = { themeColor: '#f7f3ea' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  )
}
