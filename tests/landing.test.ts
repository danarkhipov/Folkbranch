// The public site in landing/site: plain HTML, no build step. These checks keep the pages searchable and consistent:
// one title, one canonical and a reciprocal hreflang set per page, every page in the sitemap, JSON-LD that parses and
// carries the current version, and no link or image that points at a file that is not there.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../landing/site')
const ORIGIN = 'https://folkbranch.com'
const version: string = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')).version

function htmlFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'assets' ? [] : htmlFiles(p)
    return e.name.endsWith('.html') ? [p] : []
  })
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')
// index.html in a folder answers at the folder's address; 404.html is the error page.
const urlOf = (file: string) => ORIGIN + '/' + rel(file).replace(/(^|\/)index\.html$/, '$1')

const decode = (s: string) =>
  s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const visibleText = (html: string) =>
  decode(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const attr = (tag: string, name: string) => decode(tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'))?.[1] ?? '')
const tags = (html: string, name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? []

const files = htmlFiles(ROOT)
const pages = files.filter((f) => rel(f) !== '404.html').map((f) => ({ file: f, rel: rel(f), url: urlOf(f), html: fs.readFileSync(f, 'utf8') }))
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8')
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])

const alternates = (html: string) =>
  Object.fromEntries(
    tags(html, 'link')
      .filter((t) => attr(t, 'rel') === 'alternate' && attr(t, 'hreflang'))
      .map((t) => [attr(t, 'hreflang'), attr(t, 'href')]),
  ) as Record<string, string>
const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1])
const byUrl = new Map(pages.map((p) => [p.url, p]))

describe('site pages', () => {
  it('has the home pages and the four guides in both languages', () => {
    const urls = pages.map((p) => p.url)
    for (const base of ['', 'ru/']) {
      expect(urls).toContain(`${ORIGIN}/${base}`)
      for (const g of ['alternatives', 'gedcom', 'install', 'privacy']) expect(urls).toContain(`${ORIGIN}/${base}${g}/`)
    }
  })

  it('gives every page one title, one description and one h1, none shared with another page', () => {
    const titles = new Set<string>()
    const descriptions = new Set<string>()
    for (const p of pages) {
      const t = [...p.html.matchAll(/<title>([^<]*)<\/title>/g)]
      expect(t, `${p.rel} title`).toHaveLength(1)
      const title = decode(t[0][1]).trim()
      expect(title.length, `${p.rel} title length`).toBeGreaterThan(20)
      expect(title.length, `${p.rel} title length`).toBeLessThanOrEqual(70)
      expect(titles.has(title), `${p.rel} repeats a title`).toBe(false)
      titles.add(title)
      const d = tags(p.html, 'meta').filter((m) => attr(m, 'name') === 'description')
      expect(d, `${p.rel} description`).toHaveLength(1)
      const desc = attr(d[0], 'content')
      expect(desc.length, `${p.rel} description length`).toBeGreaterThan(100)
      expect(desc.length, `${p.rel} description length`).toBeLessThanOrEqual(170)
      expect(descriptions.has(desc), `${p.rel} repeats a description`).toBe(false)
      descriptions.add(desc)
      expect(p.html.match(/<h1[\s>]/g), `${p.rel} h1`).toHaveLength(1)
    }
  })

  it('has a canonical equal to its own address and an indexable robots tag', () => {
    for (const p of pages) {
      const c = tags(p.html, 'link').filter((t) => attr(t, 'rel') === 'canonical')
      expect(c, `${p.rel} canonical`).toHaveLength(1)
      expect(attr(c[0], 'href'), p.rel).toBe(p.url)
      const robots = tags(p.html, 'meta').find((m) => attr(m, 'name') === 'robots')
      expect(attr(robots ?? '', 'content'), `${p.rel} robots`).not.toMatch(/noindex/)
      expect(attr(tags(p.html, 'meta').find((m) => attr(m, 'property') === 'og:url') ?? '', 'content'), `${p.rel} og:url`).toBe(p.url)
    }
  })

  it('has a reciprocal hreflang set: each page it names exists and names it back', () => {
    for (const p of pages) {
      const lang = p.html.match(/<html lang="([^"]+)"/)![1]
      const alt = alternates(p.html)
      expect(alt[lang], `${p.rel} names itself`).toBe(p.url)
      expect(Object.keys(alt).sort(), p.rel).toEqual(['en', 'ru', 'x-default'])
      expect(alt['x-default'], p.rel).toBe(alt.en)
      for (const [code, href] of Object.entries(alt)) {
        const target = byUrl.get(href)
        expect(target, `${p.rel} points at ${href}, which is not a page`).toBeDefined()
        if (code === 'x-default') continue
        expect(alternates(target!.html)[lang], `${href} does not point back at ${p.url}`).toBe(p.url)
      }
    }
  })

  it('lists every page in sitemap.xml, with the same alternates, and every sitemap address has a file', () => {
    expect(new Set(sitemapUrls).size, 'duplicate sitemap address').toBe(sitemapUrls.length)
    expect([...sitemapUrls].sort()).toEqual(pages.map((p) => p.url).sort())
    for (const loc of sitemapUrls) {
      const block = sitemap.match(new RegExp(`<url><loc>${loc}</loc>[\\s\\S]*?</url>`))![0]
      const inMap = Object.fromEntries([...block.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]))
      expect(inMap, loc).toEqual(alternates(byUrl.get(loc)!.html))
      expect(block, loc).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/)
      const file = path.join(ROOT, new URL(loc).pathname.slice(1), loc.endsWith('/') ? 'index.html' : '')
      expect(fs.existsSync(file), `${loc} has no file`).toBe(true)
    }
  })

  it('names the sitemap in robots.txt and lists every guide in llms.txt', () => {
    expect(fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8')).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`)
    const llms = fs.readFileSync(path.join(ROOT, 'llms.txt'), 'utf8')
    for (const p of pages.filter((x) => x.rel !== 'index.html')) {
      expect(llms, p.url).toContain(p.url)
    }
    expect(llms).toContain(`v${version}`)
  })
})

describe('structured data', () => {
  it('parses as JSON on every page and has a breadcrumb, a page node inside the site, and the current version', () => {
    for (const p of pages) {
      const blocks = jsonLd(p.html)
      expect(blocks.length, `${p.rel} has JSON-LD`).toBeGreaterThan(0)
      const nodes = blocks.flatMap((b) => {
        const parsed = JSON.parse(b)
        return parsed['@graph'] ?? [parsed]
      })
      const versions = nodes.filter((n) => n.softwareVersion !== undefined).map((n) => n.softwareVersion)
      expect(versions.length, `${p.rel} softwareVersion`).toBeGreaterThan(0)
      for (const v of versions) expect(v, p.rel).toBe(version)
      const isGuide = !['index.html', 'ru/index.html'].includes(p.rel)
      if (isGuide) {
        const page = nodes.find((n) => ['WebPage', 'TechArticle'].includes(n['@type']))
        expect(page.url, p.rel).toBe(p.url)
        expect(page.dateModified, p.rel).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(page.isPartOf, p.rel).toEqual({ '@id': `${ORIGIN}/#website` })
        const crumbs = nodes.find((n) => n['@type'] === 'BreadcrumbList')
        expect(crumbs.itemListElement.at(-1).item, p.rel).toBe(p.url)
        // the visible breadcrumb says the same
        expect(p.html, p.rel).toMatch(/<nav class="crumbs"[^>]*><ol><li><a href="\/(ru\/)?">/)
      }
    }
  })

  it('shows the same questions and answers on the page as the FAQPage block says', () => {
    for (const p of pages) {
      const faq = jsonLd(p.html)
        .flatMap((b) => JSON.parse(b)['@graph'] ?? [])
        .find((n) => n['@type'] === 'FAQPage')
      if (!faq) continue
      const text = visibleText(p.html)
      expect(faq.mainEntity.length, p.rel).toBeGreaterThan(0)
      for (const q of faq.mainEntity) {
        expect(text, `${p.rel}: question`).toContain(q.name)
        expect(text, `${p.rel}: answer to "${q.name}"`).toContain(q.acceptedAnswer.text)
      }
    }
  })

  it('shows the current version in the footer', () => {
    for (const p of pages) {
      const footer = p.html.match(/<footer[\s\S]*?<\/footer>/)![0]
      const shown = [...footer.matchAll(/>v(\d+\.\d+\.\d+)</g)].map((m) => m[1])
      expect(shown, p.rel).toEqual([version])
    }
  })
})

describe('links and images', () => {
  const fileFor = (from: string, ref: string): string | null => {
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) return null // other sites, mailto:, tel:
    const clean = ref.split('#')[0].split('?')[0]
    if (clean === '') return from
    const target = clean.startsWith('/') ? path.join(ROOT, clean) : path.resolve(path.dirname(from), clean)
    return clean.endsWith('/') ? path.join(target, 'index.html') : target
  }

  it('points every internal link, file and stylesheet url at something that exists', () => {
    for (const p of [...pages, { file: path.join(ROOT, '404.html'), rel: '404.html', url: '', html: fs.readFileSync(path.join(ROOT, '404.html'), 'utf8') }]) {
      const refs: string[] = []
      for (const t of tags(p.html, 'a')) refs.push(attr(t, 'href'))
      for (const t of tags(p.html, 'link')) refs.push(attr(t, 'href'))
      for (const t of [...tags(p.html, 'img'), ...tags(p.html, 'script'), ...tags(p.html, 'source')]) refs.push(attr(t, 'src'))
      for (const m of p.html.matchAll(/url\(([^)]+)\)/g)) refs.push(m[1].replace(/['"]/g, ''))
      for (const t of tags(p.html, 'link')) {
        const set = attr(t, 'imagesrcset')
        if (set) for (const part of set.split(',')) refs.push(part.trim().split(/\s+/)[0])
      }
      for (const ref of refs.filter(Boolean)) {
        const f = fileFor(p.file, ref)
        if (!f) continue
        expect(fs.existsSync(f), `${p.rel}: ${ref} has no file`).toBe(true)
        const hash = ref.split('#')[1]
        if (hash && f.endsWith('.html')) {
          expect(fs.readFileSync(f, 'utf8'), `${p.rel}: ${ref} has no such id`).toMatch(new RegExp(`\\sid="${hash}"`))
        }
      }
    }
  })

  it('gives every image alt text, a width and a height', () => {
    for (const p of pages) {
      for (const t of tags(p.html, 'img')) {
        expect(/\salt="/.test(t), `${p.rel}: ${t} has no alt`).toBe(true)
        expect(attr(t, 'width'), `${p.rel}: ${t}`).toMatch(/^\d+$/)
        expect(attr(t, 'height'), `${p.rel}: ${t}`).toMatch(/^\d+$/)
      }
    }
  })

  it('links the four guides from every page footer', () => {
    for (const p of pages) {
      const prefix = p.url.includes('/ru/') || p.url === `${ORIGIN}/ru/` ? '/ru' : ''
      const footer = p.html.match(/<footer[\s\S]*?<\/footer>/)![0]
      for (const g of ['alternatives', 'gedcom', 'install', 'privacy']) expect(footer, p.rel).toContain(`href="${prefix}/${g}/"`)
    }
  })
})

describe('404 page', () => {
  it('is kept out of search results', () => {
    const html = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8')
    const robots = tags(html, 'meta').find((m) => attr(m, 'name') === 'robots')
    expect(attr(robots ?? '', 'content')).toMatch(/noindex/)
    expect(sitemapUrls.some((u) => u.endsWith('404.html'))).toBe(false)
  })
})

describe('home pages', () => {
  const homes = pages.filter((p) => ['index.html', 'ru/index.html'].includes(p.rel))
  const installCommand = 'curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sh'

  it('offers the live demo and the install block before the steps, with the real command to copy', () => {
    for (const p of homes) {
      expect(p.html, p.rel).toContain('href="https://demo.folkbranch.com/"')
      expect(p.html, p.rel).toContain('href="#install"')
      expect(p.html, p.rel).toMatch(/<section id="install"/)
      expect(p.html, p.rel).toContain(`<code id="c-mac">${installCommand}</code>`)
      expect(p.html.indexOf('id="install"'), p.rel).toBeLessThan(p.html.indexOf('id="how"'))
    }
  })

  it('has six questions, the first three open and the rest closed', () => {
    for (const p of homes) {
      const items = p.html.match(/<details[^>]*>/g) ?? []
      expect(items.length, p.rel).toBe(6)
      expect(items.map((t) => t.includes('open')), p.rel).toEqual([true, true, true, false, false, false])
    }
  })

  it('keeps the old decoration and the claims we cannot stand behind off the page', () => {
    const banned = [/chapter (one|two|three|four|five|six|seven)/i, /глава (первая|вторая|третья|четвёртая|пятая|шестая|седьмая)/i, /kept for good/i, /not even we can see/i, /nobody can close/i, /family\.db/i]
    for (const p of homes) for (const re of banned) expect(visibleText(p.html), `${p.rel} ${re}`).not.toMatch(re)
  })
})
