import { publicOrigins } from './public-url'

/**
 * Cookies travel on their own, so a write with a cookie must prove it comes from our own pages.
 * Browsers always send Origin or Sec-Fetch-Site on such requests; a request with neither is refused.
 */
export function fromOurPages(h: Headers) {
  const origin = h.get('origin')
  if (origin) {
    try {
      const host = new URL(origin).host
      // Behind a platform's edge the address people see can arrive in any of these. A page cannot forge them in a browser.
      return host === h.get('host') || host === h.get('x-forwarded-host') || publicOrigins().some((u) => new URL(u).host === host)
    } catch {
      return false
    }
  }
  return h.get('sec-fetch-site') === 'same-origin'
}
