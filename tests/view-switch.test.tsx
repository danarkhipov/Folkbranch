// Tree or map is one choice shown whole: both options, the current one marked, one Tab stop for the pair.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App, type AppCtx } from '../lib/client'
import { ViewSwitch } from '../components/chart-bars'

const render = (map: boolean) => renderToStaticMarkup(createElement(App.Provider, { value: { t: (k: string) => k } as unknown as AppCtx }, createElement(ViewSwitch, { map, onChange: () => {}, folded: false })))
const radios = (html: string) => [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0])

describe('the tree-or-map switch', () => {
  it('is a radio group with both views and marks the one shown', () => {
    for (const map of [false, true]) {
      const html = render(map)
      expect(html).toMatch(/role="radiogroup"[^>]*aria-label="Как показать"/)
      expect(html).toContain('Схема')
      expect(html).toContain('Карта')
      const [tree, onMap] = radios(html)
      expect(tree).toContain(`aria-checked="${!map}"`)
      expect(onMap).toContain(`aria-checked="${map}"`)
      // Only the current choice takes a Tab stop; arrows move to the other.
      expect((map ? onMap : tree)).toContain('tabindex="0"')
      expect((map ? tree : onMap)).toContain('tabindex="-1"')
    }
  })
})
