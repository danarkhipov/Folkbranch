'use client'
import { RetryScreen } from '@/components/retry-screen'

export default function GlobalError() {
  return (
    // No language of its own: the screen reads the browser's.
    <html>
      <body style={{ margin: 0 }}>
        <RetryScreen />
      </body>
    </html>
  )
}
