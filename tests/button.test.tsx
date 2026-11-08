import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from '../components/ui/button'

// A button that becomes a link, and one that waits for work, are both used across the settings screens.
describe('Button', () => {
  it('can wrap a link without breaking it', () => {
    const html = renderToStaticMarkup(createElement(Button, { asChild: true, loading: true }, createElement('a', { href: '/x' }, 'Скачать')))
    expect(html).toContain('<a ')
    expect(html).toContain('Скачать')
  })
  it('says it is busy and cannot be pressed twice', () => {
    const html = renderToStaticMarkup(createElement(Button, { loading: true }, 'Сохранить'))
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('disabled')
    expect(html).toContain('Сохранить')
  })
})
