'use client'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface Present { id: string; name: string; focusId: string | null }

/** What a change elsewhere can touch. An open page's text stays out: its editor settles that by itself. */
const FRESH = ['graph', 'history', 'gaps', 'pages', 'media', 'proposals', 'views']
const RETRY_MS = 2000
const MAX_RETRY_MS = 60_000
const SPREAD_MS = 3000
/** The server speaks at least every 25 seconds. Silence this long means a line that died without saying so: a laptop waking up, a changed network. */
const SILENCE_MS = 70_000
const CHECK_MS = 15_000

/** Keeps this page in step with the others, and closes the line while the tab is hidden. */
export function useLive(focusId: string | null) {
  const qc = useQueryClient()
  const [present, setPresent] = useState<Present[]>([])
  const client = useRef<string | null>(null)
  const focus = useRef(focusId)

  useEffect(() => {
    let source: EventSource | null = null
    let again: ReturnType<typeof setTimeout> | undefined
    let wait = RETRY_MS
    let returning = false
    let heard = 0
    const refresh = () => FRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
    const open = () => {
      if (source || document.hidden) return
      source = new EventSource('/api/events')
      heard = Date.now()
      const alive = () => { heard = Date.now() }
      source.addEventListener('ping', alive)
      source.addEventListener('hello', (e) => {
        alive()
        client.current = JSON.parse((e as MessageEvent).data).id
        wait = RETRY_MS
        // Whatever changed before this line opened was not announced here. After a restart all pages ask at once, so they spread out.
        setTimeout(refresh, returning ? Math.random() * SPREAD_MS : 0)
        returning = true
        if (focus.current) api('presence', { json: { client: client.current, focusId: focus.current } }).catch(() => {})
      })
      source.addEventListener('change', () => { alive(); refresh() })
      source.addEventListener('presence', (e) => { alive(); setPresent(JSON.parse((e as MessageEvent).data)) })
      // The browser retries a dropped line by itself, but gives up for good on an error page, such as during a deploy.
      source.onerror = () => {
        if (source?.readyState !== EventSource.CLOSED) return
        source = null
        client.current = null
        again = setTimeout(open, wait * (0.5 + Math.random()))
        wait = Math.min(wait * 2, MAX_RETRY_MS)
      }
    }
    const close = () => {
      clearTimeout(again)
      source?.close()
      source = null
      client.current = null
    }
    const onVisibility = () => {
      if (document.hidden) return close()
      // Only this page is coming back, so it need not wait its turn.
      returning = false
      open()
    }
    open()
    document.addEventListener('visibilitychange', onVisibility)
    const watch = setInterval(() => {
      if (source && Date.now() - heard > SILENCE_MS) {
        close()
        open()
      }
    }, CHECK_MS)
    return () => {
      clearInterval(watch)
      document.removeEventListener('visibilitychange', onVisibility)
      close()
    }
  }, [qc])

  useEffect(() => {
    focus.current = focusId
    if (client.current) api('presence', { json: { client: client.current, focusId } }).catch(() => {})
  }, [focusId])

  return present
}
