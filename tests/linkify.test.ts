import { describe, expect, it } from 'vitest'
import { decorateBlocks, isUrl, shortUrl, splitText } from '../lib/linkify'

describe('addresses in text', () => {
  it('finds them, leaves the punctuation behind, and shows the short form', () => {
    expect(splitText('см. https://www.example.org/a/b?x=1, там')).toEqual([{ text: 'см. ' }, { text: 'example.org/a/b', href: 'https://www.example.org/a/b?x=1' }, { text: ', там' }])
    expect(splitText('без адреса')).toEqual([{ text: 'без адреса' }])
    expect(isUrl(' https://a.ru/x ')).toBe(true)
    expect(isUrl('см. https://a.ru')).toBe(false)
  })
  it('does not offer anything but web addresses', () => {
    expect(splitText('javascript:alert(1) и file:///etc/passwd')).toEqual([{ text: 'javascript:alert(1) и file:///etc/passwd' }])
  })
  it('keeps a long path readable and a broken address as it is', () => {
    expect(shortUrl(`https://archive.example.org/${'x'.repeat(60)}`).length).toBeLessThan(60)
    expect(shortUrl('https://[broken')).toBe('https://[broken')
  })
  it('tells file names and record numbers from words', () => {
    const parts = splitText('TG-3000 result.json#message=3000; photos/photo_1@01-01-2020_10-00-00.jpg — фотография, 1945 год', true)
    expect(parts.filter((p) => p.reference).map((p) => p.text)).toEqual(['TG-3000', 'result.json#message=3000', 'photos/photo_1@01-01-2020_10-00-00.jpg'])
    expect(parts.map((p) => p.text).join('')).toBe('TG-3000 result.json#message=3000; photos/photo_1@01-01-2020_10-00-00.jpg — фотография, 1945 год')
    expect(splitText('Жил в г. Пермь. А-12 не номер, но 1945-1950 тоже', true).filter((p) => p.reference)).toEqual([])
  })
})

describe('a page', () => {
  const text = (t: string, styles = {}) => ({ type: 'text', text: t, styles })
  it('gets links and quiet references, at every depth, and loses no words', () => {
    const [b] = decorateBlocks([{ type: 'bulletListItem', content: [text('WEB-011 https://a.ru/b — история', { bold: true })], children: [{ type: 'paragraph', content: [text('файл x.pdf')], children: [] }] }])
    expect(b.content).toEqual([text('WEB-011', { bold: true, code: true }), text(' ', { bold: true }), { type: 'link', href: 'https://a.ru/b', content: [text('a.ru/b', { bold: true })] }, text(' — история', { bold: true })])
    expect(b.children[0].content[1]).toEqual(text('x.pdf', { code: true }))
  })
  it('leaves mentions, marks and written code alone, and goes into tables', () => {
    const mention = { type: 'mention', props: { personId: 'p' } }
    const code = text('https://a.ru', { code: true })
    const [b] = decorateBlocks([{ type: 'paragraph', content: [mention, code], children: [] }])
    expect(b.content).toEqual([mention, code])
    const [t] = decorateBlocks([{ type: 'table', content: { type: 'tableContent', rows: [{ cells: [[text('https://a.ru')], { type: 'tableCell', content: [text('https://b.ru')] }] }] }, children: [] }]) as any[]
    expect(t.content.rows[0].cells[0][0].href).toBe('https://a.ru')
    expect(t.content.rows[0].cells[1].content[0].href).toBe('https://b.ru')
  })
  it('a link that only repeats its address gets the short form, a named one keeps its name', () => {
    const named = { type: 'link', href: 'https://a.ru/x', content: [text('Архив')] }
    const bare = { type: 'link', href: 'https://a.ru/x', content: [text('https://a.ru/x')] }
    const [b] = decorateBlocks([{ type: 'paragraph', content: [named, bare] }]) as any[]
    expect(b.content[0]).toEqual(named)
    expect(b.content[1].content[0].text).toBe('a.ru/x')
  })
})
