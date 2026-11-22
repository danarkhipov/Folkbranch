import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChronicleText } from '../components/chronicle-text'

// An entry's words come from an agent: they become text, emphasis, safe links and buttons, never markup of their own.
const html = (value: string, opts: { onPerson?: (id: string) => void; first?: boolean } = {}) => renderToStaticMarkup(createElement(ChronicleText, { value, ...opts }))

describe('ChronicleText', () => {
  it('splits paragraphs on a blank line', () => {
    expect(html('One.\n\nTwo.\n  \nThree.')).toBe('<p>One.</p><p>Two.</p><p>Three.</p>')
    expect(html('One.\n\nTwo.', { first: true })).toBe('<p>One.</p>')
  })
  it('prints bold and italic', () => {
    expect(html('a **front** and *a line*')).toBe('<p>a <strong>front</strong> and <em>a line</em></p>')
  })
  it('makes an https link that opens apart', () => {
    expect(html('see [the atlas](https://example.org/a)')).toBe('<p>see <a href="https://example.org/a" target="_blank" rel="noreferrer noopener">the atlas</a></p>')
  })
  it('keeps brackets inside an address', () => {
    expect(html('[war](https://example.org/War_(1856))')).toBe('<p><a href="https://example.org/War_(1856)" target="_blank" rel="noreferrer noopener">war</a></p>')
  })
  it('turns a mention into a button only when it can go somewhere', () => {
    expect(html('[@Ada Test](person:p1) left', { onPerson: () => {} })).toBe('<p><button type="button" class="chronicle-mention">Ada Test</button> left</p>')
    expect(html('[@Ada Test](person:p1) left')).toBe('<p><span class="chronicle-mention">Ada Test</span> left</p>')
  })
  it('never makes a link of an unsafe address', () => {
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', '/settings', 'http://example.org']) {
      const out = html(`click [here](${bad}) now`)
      expect(out).toBe('<p>click here now</p>')
      expect(out).not.toContain('<a')
    }
  })
  it('never lets markup through', () => {
    const out = html('<img src=x onerror=alert(1)> **<b>x</b>** [<i>y</i>](https://example.org)')
    expect(out).not.toMatch(/<img|<b>|<i>/)
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})
