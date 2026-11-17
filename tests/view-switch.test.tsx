// The view's corner: zoom, then tree or map as one choice shown whole: both options, the current one marked, one Tab stop for the pair.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App, type AppCtx } from '../lib/client'
import { ViewTools } from '../components/chart-bars'

const render = (map: boolean, folded = false) => renderToStaticMarkup(createElement(App.Provider, { value: { t: (k: string) => k } as unknown as AppCtx }, createElement(ViewTools, { map, onChange: () => {}, onZoom: () => {}, folded, card: false })))
const radios = (html: string) => [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0])

describe('the tree-or-map switch', () => {
  it('is a radio group with both views and marks the one shown', () => {
    for (const map of [false, true]) {
      const html = render(map)
      expect(html).toMatch(/role="radiogroup"[^>]*aria-label="Как показать"/)
      expect(html).toContain('aria-label="Схема"')
      expect(html).toContain('aria-label="Карта"')
      // Zoom sits in the same corner in both views.
      expect(html).toContain('aria-label="Приблизить"')
      expect(html).toContain('aria-label="Отдалить"')
      const [tree, onMap] = radios(html)
      expect(tree).toContain(`aria-checked="${!map}"`)
      expect(onMap).toContain(`aria-checked="${map}"`)
      // Only the current choice takes a Tab stop; arrows move to the other.
      expect((map ? onMap : tree)).toContain('tabindex="0"')
      expect((map ? tree : onMap)).toContain('tabindex="-1"')
    }
  })
  it('hides with the other panels and cannot be reached while hidden', () => {
    expect(render(false, true)).toMatch(/^<div inert="" class="[^"]*folded/)
    expect(render(false)).not.toContain('inert')
  })
})
