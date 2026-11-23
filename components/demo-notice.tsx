'use client'
import { useEffect, useRef, useState } from 'react'

/**
 * Some screens never catch a refused request, so the person pressed a button and nothing seemed to happen.
 * In the demo a refusal that nobody caught is shown here, in the server's own words.
 */
export function DemoNotice() {
  const [text, setText] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    const onRejected = (e: PromiseRejectionEvent) => {
      const r = e.reason as { status?: number; message?: unknown } | null
      if (r?.status !== 403 || typeof r.message !== 'string' || !r.message.startsWith('Not available in the demo')) return
      e.preventDefault()
      setText(r.message)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setText(''), 8000)
    }
    window.addEventListener('unhandledrejection', onRejected)
    return () => { window.removeEventListener('unhandledrejection', onRejected); clearTimeout(timer.current) }
  }, [])
  if (!text) return null
  return <div role="alert" data-demo-notice className="fixed bottom-4 left-1/2 z-[100] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-lg bg-ink px-4 py-2.5 text-sm text-paper shadow-lg">{text}</div>
}
