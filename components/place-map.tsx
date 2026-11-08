'use client'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Map as MapIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/client'

// The map's pictures come from OpenStreetMap, which then sees what part of the world is looked at.
// Nothing about the family goes there, but each device still says yes once before the first request.
const KEY = 'map-tiles'
const listeners = new Set<() => void>()
const allowed = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
const allow = () => {
  try { localStorage.setItem(KEY, '1') } catch {}
  listeners.forEach((l) => l())
}
export const useMapAllowed = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, allowed, () => false)

export interface MapMark { id: string; lat: number; lon: number; title: string; note?: string; people: { id: string; name: string }[] }

const MAX_NAMES = 8

/** Places on a map. With `path` the marks are stops of one life, joined in order and numbered. */
export function PlaceMap({ marks, path = false, onPerson, className = 'h-72' }: { marks: MapMark[]; path?: boolean; onPerson: (id: string) => void; className?: string }) {
  const { t } = useApp()
  const ok = useMapAllowed()
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)
  const pick = useRef(onPerson)
  pick.current = onPerson

  useEffect(() => {
    if (!ok || !box.current || !marks.length) return
    let gone = false
    void import('leaflet').then((L) => {
      if (gone || !box.current) return
      const m = L.map(box.current, { scrollWheelZoom: false, attributionControl: true })
      map.current = m
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">OpenStreetMap</a>' }).addTo(m)
      const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#a4502e'
      const points = marks.map((x) => L.latLng(x.lat, x.lon))
      if (path && points.length > 1) L.polyline(points, { color, weight: 2, dashArray: '4 6' }).addTo(m)
      marks.forEach((x, i) => {
        const dot = L.circleMarker(points[i], { radius: path ? 9 : Math.min(14, 6 + x.people.length), color, weight: 2, fillColor: color, fillOpacity: 0.35 }).addTo(m)
        if (path) dot.bindTooltip(String(i + 1), { permanent: true, direction: 'center', className: 'map-number' })
        // Built from elements, not HTML: names and places are what relatives typed.
        const card = document.createElement('div')
        card.className = 'map-card'
        const title = card.appendChild(document.createElement('strong'))
        title.textContent = path ? `${i + 1}. ${x.title}` : x.title
        if (x.note) card.appendChild(document.createElement('div')).textContent = x.note
        const names = card.appendChild(document.createElement('div'))
        x.people.slice(0, MAX_NAMES).forEach((p) => {
          const b = names.appendChild(document.createElement('button'))
          b.type = 'button'
          b.textContent = p.name
          b.onclick = () => pick.current(p.id)
        })
        if (x.people.length > MAX_NAMES) names.appendChild(document.createElement('span')).textContent = `+${x.people.length - MAX_NAMES}`
        dot.bindPopup(card)
      })
      if (points.length === 1) m.setView(points[0], 9)
      else m.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 10 })
    })
    return () => {
      gone = true
      map.current?.remove()
      map.current = null
    }
  }, [ok, marks, path])

  if (!marks.length) return null
  if (!ok) {
    return (
      <div className={`flex flex-col items-start justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm ${className}`}>
        <p className="text-ink-soft">{t('Карту рисует OpenStreetMap: его сервер увидит, какую часть мира вы смотрите. Имена и даты туда не попадают.')}</p>
        <Button size="sm" variant="outline" onClick={allow}><MapIcon /> {t('Показать карту')}</Button>
      </div>
    )
  }
  return <div ref={box} role="region" aria-label={t('Карта')} className={`map-box relative z-0 overflow-hidden rounded-lg border border-border ${className}`} />
}
