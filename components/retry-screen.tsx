'use client'
import { useEffect, useState } from 'react'

const WORDS = {
  ru: { title: 'Архив обновляется или нет связи', text: 'Это займёт меньше минуты. Страница откроется сама, ваши данные на месте.', again: 'Открыть сейчас' },
  en: { title: 'The archive is updating or unreachable', text: 'This takes under a minute. The page reopens by itself; your data is safe.', again: 'Open now' },
}

/** What a person sees when the page cannot be drawn, usually for the moments a new version is being put in place. It asks the server until it answers, then reloads. */
export function RetryScreen({ onRetry }: { onRetry?: () => void }) {
  const [lang] = useState<'ru' | 'en'>(() => (typeof document !== 'undefined' && (document.documentElement.lang || navigator.language).startsWith('en') ? 'en' : 'ru'))
  const w = WORDS[lang]
  useEffect(() => {
    let stop = false
    const ask = async () => {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' })
        if (r.ok && !stop) return void (onRetry ? onRetry() : location.reload())
      } catch {}
      if (!stop) timer = setTimeout(ask, 2000)
    }
    let timer = setTimeout(ask, 1500)
    return () => { stop = true; clearTimeout(timer) }
  }, [onRetry])
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#f7f3ea', color: '#2a241c', font: "16px/1.45 Georgia, 'Times New Roman', serif", padding: 24, boxSizing: 'border-box' }}>
      <div role="status" style={{ maxWidth: '26rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 500, margin: '0 0 .4rem' }}>{w.title}</h1>
        <p style={{ margin: '0 0 1rem', color: '#5d5446', fontSize: '.95rem' }}>{w.text}</p>
        <button onClick={() => (onRetry ? onRetry() : location.reload())} style={{ padding: '.55rem 1rem', border: '1px solid #b9ae98', borderRadius: 8, background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>{w.again}</button>
      </div>
    </main>
  )
}
