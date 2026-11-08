'use client'
import { RetryScreen } from '@/components/retry-screen'

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <RetryScreen onRetry={reset} />
}
