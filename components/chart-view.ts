'use client'
import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { select } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import { cardBox, CARD_H, type EdgePos, type Layout } from '@/lib/graph/layout'
import { nextView, touches, type Box } from '@/lib/graph/visible'

/** Below this zoom no name can be read, so captions and hover highlights stop costing anything. */
const FAR_ZOOM = 0.25
/** A little longer than the chart's move, which keeps both ends of it on the page. */
const MOVE_MS = 500
/** The whole family is fitted on screen only down to this zoom. */
const READABLE_ZOOM = 0.65

/** Panning, zooming and fitting, and which part of the chart is on the page because of them. */
export function useChartView(layout: Layout, panelOpen: boolean, leftInset: number) {
  const canvas = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown>>(null)
  /** Set once the person has panned or zoomed; from then on the view is theirs. */
  const moved = useRef(false)
  const [clipped, setClipped] = useState(false)
  // Only what is in view is on the page; during an animated move, both where it starts and where it ends.
  const [views, setViews] = useState<Box[]>([])
  const kept = useRef<Box | null>(null)
  const transform = useRef({ x: 0, y: 0, k: 1 })
  const dropOld = useRef<ReturnType<typeof setTimeout>>(undefined)

  const keepInView = () => {
    const { x, y, k } = transform.current
    const next = nextView(kept.current, x, y, k, canvas.current!.clientWidth, canvas.current!.clientHeight)
    if (!next) return
    const old = kept.current
    kept.current = next
    clearTimeout(dropOld.current)
    // The first frame must not come out empty; later ones may wait for the hand to pause.
    if (!old) return setViews([next])
    const moving = world.current!.classList.contains('animate')
    startTransition(() => setViews(moving ? [old, next] : [next]))
    if (moving) dropOld.current = setTimeout(() => setViews([next]), MOVE_MS)
  }

  const apply = (x: number, y: number, k: number) => {
    world.current!.style.transform = `translate(${x}px,${y}px) scale(${k})`
    world.current!.classList.toggle('far', k < FAR_ZOOM)
    const s = canvas.current!.style
    s.setProperty('--tx', `${x}px`)
    s.setProperty('--ty', `${y}px`)
    s.setProperty('--k', String(k))
    // Labels stay readable when zoomed out. Stepped and inherited, so a pan never restyles the cards.
    const lbl = String(Math.round(Math.min(1.3, Math.max(1, 1 / k)) * 20) / 20)
    if (s.getPropertyValue('--lbl') !== lbl) s.setProperty('--lbl', lbl)
    transform.current = { x, y, k }
    keepInView()
  }

  useEffect(() => {
    const z = d3zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.12, 2.4])
      .clickDistance(4)
      .filter((e) => e.type === 'wheel' || (!e.button && !e.target.closest?.('.tools, .link-start, .linkbar')))
      .on('zoom', (e) => {
        if (e.sourceEvent) {
          world.current?.classList.remove('animate')
          moved.current = true
          setClipped(false)
        }
        apply(e.transform.x, e.transform.y, e.transform.k)
      })
    zoomRef.current = z
    select(canvas.current!).call(z).on('dblclick.zoom', null)
    return () => { select(canvas.current!).on('.zoom', null) }
  }, [])

  const go = (x: number, y: number, k: number, animate = true) => {
    world.current!.classList.toggle('animate', animate)
    select(canvas.current!).call(zoomRef.current!.transform, zoomIdentity.translate(x, y).scale(k))
  }

  const viewport = () => {
    const el = canvas.current!
    if (!panelOpen) return { w: el.clientWidth, h: el.clientHeight }
    // The editor is a sheet at the bottom on phones, and a side panel elsewhere, as wide or tall as the person dragged it.
    const panel = document.querySelector('.panel')?.getBoundingClientRect()
    if (window.innerWidth <= 640) return { w: el.clientWidth, h: el.clientHeight - (panel?.height ?? el.clientHeight * 0.62) - 8 }
    return { w: el.clientWidth - (panel?.width ?? 480) - 12, h: el.clientHeight }
  }

  const fit = (animate = true) => {
    const b = layout.bounds
    if (!b.w) return go(viewport().w / 2, 160, 1, false)
    const { w, h } = viewport()
    const fitK = Math.min((w - 120) / b.w, (h - 170) / b.h, 1.1)
    // Smaller than this the names and years stop being readable: stay here and let the chart scroll under the hand.
    const fits = fitK >= READABLE_ZOOM
    setClipped(!fits)
    const k = fits ? fitK : READABLE_ZOOM
    if (fits) go((w - b.w * k) / 2 - b.x * k, (h - b.h * k) / 2 - b.y * k + 20, k, animate)
    else {
      // Too big for the screen: open on the person nearest the middle of the family, not on an empty corner.
      const all = [...layout.cards.values()]
      const midX = all.reduce((sum, c) => sum + c.x, 0) / all.length, midY = all.reduce((sum, c) => sum + c.y, 0) / all.length
      const c = all.reduce((best, n) => (Math.hypot(n.x - midX, n.y - midY) < Math.hypot(best.x - midX, best.y - midY) ? n : best))
      go(w / 2 - c.x * k, h / 2 - (c.y + CARD_H / 2) * k, k, animate)
    }
  }

  /** Moves the canvas only if the person is out of sight, so cards don't run away from the cursor. */
  const center = (id: string) => {
    const c = layout.cards.get(id)
    if (!c) return
    const { w, h } = viewport()
    const k = Number(canvas.current!.style.getPropertyValue('--k')) || 1
    const tx = parseFloat(canvas.current!.style.getPropertyValue('--tx')) || 0
    const ty = parseFloat(canvas.current!.style.getPropertyValue('--ty')) || 0
    const sx = tx + c.x * k, sy = ty + (c.y + CARD_H / 2) * k
    const m = 90 * k
    if (sx > leftInset + m && sx < w - m && sy > 70 + m && sy < h - m) return
    const zoom = Math.max(k, 0.6)
    go((leftInset + w) / 2 - c.x * zoom, h / 2 - (c.y + CARD_H / 2) * zoom, zoom)
  }

  const fitted = useRef(false)
  useEffect(() => {
    if (!fitted.current && layout.cards.size) {
      fitted.current = true
      fit(false)
    }
  }, [layout]) // eslint-disable-line react-hooks/exhaustive-deps

  // Only a change of the window's size refits, and only until someone pans or zooms. Editing the
  // chart never moves the view.
  const fitNow = useRef(fit)
  fitNow.current = fit
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (!moved.current) fitNow.current(false)
      else keepRef.current()
    })
    ro.observe(canvas.current!)
    return () => {
      ro.disconnect()
      clearTimeout(dropOld.current)
    }
  }, [])
  const keepRef = useRef(keepInView)
  keepRef.current = keepInView

  const shown = useMemo(() => {
    const inView = (box: Box) => views.some((v) => touches(v, box))
    const edges = layout.edges.filter((e) => inView(e.box))
    const families = new Map<string, EdgePos[]>()
    for (const e of edges) {
      const list = families.get(e.familyKey)
      if (list) list.push(e)
      else families.set(e.familyKey, [e])
    }
    return {
      cards: new Set([...layout.cards.values()].filter((c) => inView(cardBox(c))).map((c) => c.id)),
      edges,
      unions: layout.unions.filter((u) => inView(u.box)),
      families: [...families],
      /** One edge per bar, for hit areas: siblings share the same shared stretch. */
      groupHeads: [...new Map(edges.map((e) => [e.group, e] as const)).values()],
    }
  }, [layout, views])

  /** A point on the screen in the chart's own coordinates. */
  const toChart = (cx: number, cy: number) => {
    const r = canvas.current!.getBoundingClientRect()
    const { x, y, k } = transform.current
    return { x: (cx - r.left - x) / k, y: (cy - r.top - y) / k }
  }
  const zoomBy = (f: number) => {
    moved.current = true
    world.current!.classList.add('animate')
    select(canvas.current!).call(zoomRef.current!.scaleBy, f)
  }
  const refit = () => {
    moved.current = false
    fit()
  }
  return { canvas, world, clipped, shown, center, zoomBy, refit, toChart, isFar: () => !!world.current?.classList.contains('far') }
}
