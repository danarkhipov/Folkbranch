// One person on paper: a page or two to print or keep as PDF, made from what the card already holds. Everything is
// escaped here, since names, notes and stories are typed by people.
import { factWords } from './fact-kinds'
import { lifeEvents } from './family-dates'
import { lifeYears, personName, type Graph, type Person, type Story } from './types'

type Inline = { type?: string; text?: string; props?: Record<string, string>; content?: unknown }
type Block = { type?: string; props?: Record<string, unknown>; content?: unknown; children?: Block[] }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const inline = (content: unknown): string => (Array.isArray(content) ? (content as Inline[]).map((c) => (c.type === 'mention' ? c.props?.label ?? '' : c.type === 'link' ? inline(c.content) : c.text ?? '')).join('') : '')

function blocks(list: Block[]): string {
  return list.map((b) => {
    const text = esc(inline(b.content))
    const inner = b.children?.length ? blocks(b.children) : ''
    if (b.type === 'heading') return `<h3>${text}</h3>${inner}`
    if (b.type === 'bulletListItem' || b.type === 'numberedListItem' || b.type === 'checkListItem') return `<p class="li">• ${text}</p>${inner}`
    if (b.type === 'quote') return `<blockquote>${text}</blockquote>${inner}`
    if (b.type === 'image' && typeof b.props?.url === 'string' && b.props.url.startsWith('/api/')) return `<figure><img src="${esc(b.props.url)}" alt=""><figcaption>${esc(String(b.props.caption ?? ''))}</figcaption></figure>`
    return text || inner ? `<p>${text}</p>${inner}` : ''
  }).join('')
}

export interface SheetInput {
  person: Person
  graph: Graph
  pages: { title: string; content: Block[] }[]
  stories: Story[]
  avatar: string | null
  t: (key: string) => string
  lang: string
}

export function personSheet({ person, graph, pages, stories, avatar, t, lang }: SheetInput): string {
  const byId = new Map(graph.persons.map((p) => [p.id, p]))
  const shown = (id: string) => { const p = byId.get(id); return p && !p.hidden ? p : null }
  const named = (p: Person) => `${esc(personName(p) || t('Без названия'))}${lifeYears(p) ? ` <span class="soft">${esc(lifeYears(p))}</span>` : ''}`
  const parents = graph.parentChild.filter((l) => l.childId === person.id).flatMap((l) => shown(l.parentId) ?? [])
  const spouses = graph.unions.filter((u) => u.aId === person.id || u.bId === person.id).flatMap((u) => shown(u.aId === person.id ? u.bId : u.aId) ?? [])
  const children = graph.parentChild.filter((l) => l.parentId === person.id).flatMap((l) => shown(l.childId) ?? [])
  const kin = ([['Родители', parents], ['Супруги', spouses], ['Дети', children]] as [string, Person[]][]).filter(([, list]) => list.length)
  const life = lifeEvents(person, graph)
  const where = [person.birthPlace, person.deathPlace].filter(Boolean)
  const section = (title: string, body: string) => (body ? `<section><h2>${esc(t(title))}</h2>${body}</section>` : '')
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><title>${esc(personName(person))}</title><style>
@page { margin: 16mm 14mm; }
body { font: 11pt/1.5 Georgia, 'Times New Roman', serif; color: #1f1a14; margin: 0; }
header { display: flex; gap: 14px; align-items: center; border-bottom: 1px solid #b9ae98; padding-bottom: 10px; margin-bottom: 12px; }
header img { width: 84px; height: 84px; border-radius: 50%; object-fit: cover; }
h1 { font-size: 22pt; font-weight: 500; margin: 0; }
h2 { font-size: 13pt; font-weight: 600; margin: 14px 0 4px; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 8px 0 2px; }
p { margin: 0 0 6px; } .li { margin-left: 12px; } .soft { color: #6b604f; }
ul { margin: 0; padding-left: 18px; } li { margin: 0 0 3px; break-inside: avoid; }
blockquote { margin: 4px 0 8px 12px; font-style: italic; }
figure { margin: 6px 0; break-inside: avoid; } figure img { max-width: 100%; max-height: 90mm; } figcaption { font-size: 9pt; color: #6b604f; }
footer { margin-top: 16px; font-size: 8.5pt; color: #6b604f; }
</style></head><body>
<header>${avatar ? `<img src="${esc(avatar)}" alt="">` : ''}<div><h1>${esc(personName(person) || t('Без названия'))}</h1>${lifeYears(person) ? `<p class="soft">${esc(lifeYears(person))}${where.length ? ` · ${esc(where.join(' — '))}` : ''}</p>` : ''}</div></header>
${section('Хронология жизни', life.length ? `<ul>${life.map((e) => `<li><b>${esc(e.date)}</b>${e.age !== null ? ` <span class="soft">(${esc(t('возраст'))} ${e.age})</span>` : ''} ${esc(t(e.title))}${e.note ? `: ${esc(e.note)}` : ''}</li>`).join('')}</ul>` : '')}
${section('Семья', kin.map(([title, list]) => `<p><b>${esc(t(title))}:</b> ${list.map(named).join(', ')}</p>`).join(''))}
${section('Факты', person.facts.filter((f) => f.kind || factWords(f, t)).map((f) => `<p><b>${esc(f.kind)}</b>${f.date ? ` ${esc(f.date)}` : ''}${f.place ? `, ${esc(f.place)}` : ''}${factWords(f, t) ? `. ${esc(factWords(f, t))}` : ''}</p>`).join(''))}
${pages.map((p) => section(p.title || 'Биография', blocks(p.content))).join('')}
${section('Рассказы', stories.map((s) => `<h3>${esc(s.title || t('Рассказ'))}</h3>${s.body ? `<p>${esc(s.body)}</p>` : `<p class="soft">${esc(t('Запись голоса, без текста'))}</p>`}`).join(''))}
${section('Источники', person.sources.filter((s) => s.title).map((s) => `<p>${esc(s.title)}${s.ref ? `, ${esc(s.ref)}` : ''}${s.page ? `, ${esc(s.page)}` : ''}${s.record ? `, ${esc(t('запись'))} ${esc(s.record)}` : ''}${s.date ? `, ${esc(s.date)}` : ''}</p>${s.transcription ? `<blockquote>${esc(s.transcription)}</blockquote>` : ''}`).join(''))}
<footer>${esc(t('Из семейного архива'))} · ${esc(new Date().toLocaleDateString(lang))}</footer>
</body></html>`
}
