'use client'
import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true } } }))
  // A trackpad pinch arrives as ctrl+wheel. Over the canvas it zooms the chart; anywhere else, or at
  // the chart's zoom limit, the browser would magnify the whole page and push the interface off screen.
  useEffect(() => {
    const stop = (e: Event) => { if (!(e instanceof WheelEvent) || e.ctrlKey) e.preventDefault() }
    document.addEventListener('wheel', stop, { passive: false })
    document.addEventListener('gesturestart', stop)
    return () => {
      document.removeEventListener('wheel', stop)
      document.removeEventListener('gesturestart', stop)
    }
  }, [])
  return <QueryClientProvider client={client}><TooltipProvider>{children}</TooltipProvider></QueryClientProvider>
}
