'use client'
import { useEffect, useRef, useState } from 'react'

const DELAY = 250
const GAP = 8
const EDGE = 8

interface Shown { text: string; more: string; left: number; top: number; below: boolean }

/**
 * Every `title` in the app shows as this hint instead of the browser's own, so a new button gets it by itself.
 * `data-hint` adds a line on what the button does. The title goes back when the pointer leaves, so names stay readable by tools.
 */
export function Hints() {
  const [shown, setShown] = useState<Shown | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const held = useRef<{ el: HTMLElement; title: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const hide = () => {
      clearTimeout(timer.current)
      if (held.current?.el.isConnected && !held.current.el.title) held.current.el.title = held.current.title
      held.current?.el.removeAttribute('aria-describedby')
      held.current = null
      setShown(null)
    }
    const show = (target: EventTarget | null) => {
      const el = (target as Element | null)?.closest?.<HTMLElement>('[title]:not(iframe)')
      if (held.current?.el === el) return
      hide()
      if (!el?.title) return
      const title = el.title
      // Taken off at once, or the browser's own hint would come up beside this one.
      el.title = ''
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', title)
      held.current = { el, title }
      timer.current = setTimeout(() => {
        const r = el.getBoundingClientRect()
        if (el.dataset.hint) el.setAttribute('aria-describedby', 'hint-box')
        const below = r.top < 90
        setShown({ text: title, more: el.dataset.hint ?? '', left: r.left + r.width / 2, top: below ? r.bottom + GAP : r.top - GAP, below })
      }, DELAY)
    }
    const over = (e: PointerEvent) => { if (e.pointerType !== 'touch') show(e.target) }
    const out = (e: PointerEvent) => { if (held.current && !held.current.el.contains(e.relatedTarget as Node | null)) hide() }
    const focus = (e: FocusEvent) => { if ((e.target as Element).matches?.(':focus-visible')) show(e.target) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerout', out)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('focusin', focus)
    document.addEventListener('focusout', hide)
    document.addEventListener('keydown', key)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerout', out)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('keydown', key)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // Measured once on screen: it stays within the window whatever the text.
  useEffect(() => {
    if (!shown || !box.current) return
    const b = box.current
    const half = b.offsetWidth / 2
    b.style.left = `${Math.min(Math.max(shown.left, half + EDGE), window.innerWidth - half - EDGE)}px`
    b.style.visibility = 'visible'
  }, [shown])

  if (!shown) return null
  return (
    <div ref={box} id="hint-box" role="tooltip" className="hint" style={{ left: shown.left, top: shown.top, visibility: 'hidden', transform: `translate(-50%, ${shown.below ? '0' : '-100%'})` }}>
      <div className="font-medium">{shown.text}</div>
      {shown.more && <div className="hint-more">{shown.more}</div>}
    </div>
  )
}
