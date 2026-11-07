// The family as one HTML file to send to relatives: it opens with no server, no account and no network.
// Built with what a reader may see, so the living stay unnamed. Only fields written out below reach the file:
// a new column on a person must be added here on purpose before it can travel.
import { layoutFamily, AVATAR_CY } from '../graph/layout'
import { translate } from '../i18n'
import { blocksToMarkdown } from '../markdown'
import { lifeYears, personName, type Graph, type Person } from '../types'
import { Actor, requireRole } from './core'
import { canSeeMedia, listPersonMedia, readAvatar, readMediaFile } from './media'
import { readablePages } from './pages'
import { getGraph } from './people'
import { archiveLang, getSetting } from './settings'
import { listViews, MAIN_VIEW } from './views'

/** Fits in a messenger and opens on an old phone. Past it photos get smaller, then stay out. */
const PHOTO_BUDGET = 25 * 1024 * 1024
const PHOTOS_PER_PERSON = 8
const PROJECT_URL = 'https://github.com/danarkhipov/Folkbranch'
const AVATAR = 30

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const dataUri = (mime: string, data: Buffer) => `data:${mime};base64,${data.toString('base64')}`
const webLink = (url: string) => (/^https?:\/\//i.test(url) ? url : '')

/** Names wrap by words; a word longer than a line is cut, as on the printed chart. */
function lines(text: string, max = 14, most = 3) {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && `${line} ${word}`.length > max) { out.push(line); line = '' }
    line = line ? `${line} ${word}` : word
    while (line.length > max) { out.push(`${line.slice(0, max - 1)}-`); line = line.slice(max - 1) }
  }
  if (line) out.push(line)
  return out.length > most ? [...out.slice(0, most - 1), `${out[most - 1].slice(0, max - 1)}…`] : out
}

/** A biography as plain paragraphs: pictures in the text are server addresses, and mean nothing in a file. */
function pageHtml(content: string) {
  let md = ''
  try { md = blocksToMarkdown(JSON.parse(content)) } catch { return '' }
  return md.split('\n').map((raw) => {
    const line = raw.trim()
      .replace(/^!\[.*\]\(.*\)$/, '').replace(/^<!--.*-->$/, '').replace(/^---$/, '')
      .replace(/\[@?([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|`/g, '').replace(/(^|\s)\*(\S)/g, '$1$2').replace(/(\S)\*(\s|$)/g, '$1$2')
    if (!line) return ''
    const heading = line.match(/^#+\s+(.*)/)
    if (heading) return `<h4>${esc(heading[1])}</h4>`
    return `<p>${esc(line.replace(/^>\s*/, ''))}</p>`
  }).join('')
}

const STYLE = `
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:#f7f3ea;color:#2a2620;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
h1,h2,h3{font-family:Georgia,"Times New Roman",serif;font-weight:500;line-height:1.2;margin:0}
a{color:inherit}
header{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding:16px}
header h1{font-size:26px;overflow-wrap:anywhere}header p{margin:0;color:#6b6456;font-size:14px}
.tools{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px 10px}
.tools input{flex:1 1 200px;min-width:0;height:44px;padding:0 12px;border:1px solid #d8d0bf;border-radius:10px;background:#fff;font:inherit;color:inherit}
.tools button{width:44px;height:44px;border:1px solid #d8d0bf;border-radius:10px;background:#fff;font:inherit;font-size:20px;color:inherit;cursor:pointer}
.chart{overflow:auto;max-height:72vh;background:#fffdf8;border-block:1px solid #e5decf;-webkit-overflow-scrolling:touch}
.chart svg{display:block;max-width:none}
.chart a{cursor:pointer}.chart a:hover .ring,.chart a:focus .ring{stroke-width:4}
.chart text{paint-order:stroke;stroke:#fffdf8;stroke-width:4px;stroke-linejoin:round;text-anchor:middle}
.name{font:600 15px Georgia,"Times New Roman",serif;fill:#2a2620}.years{font-size:13px;fill:#6b6456}.mark{font:600 20px Georgia,serif;fill:#6b6456;stroke:none}
.line{fill:none;stroke:#948b7a;stroke-width:1.5}.dash{stroke-dasharray:5 4}.dot{fill:#2a2620}
.ring{fill:#f1ebdd;stroke-width:2.5}.M{stroke:#5c7a82}.F{stroke:#b4694f}.U{stroke:#8a8272}
.people{padding:20px 16px;max-width:1100px}.people h2{font-size:21px;margin-bottom:10px}
.people ul{list-style:none;margin:0;padding:0;columns:280px auto;column-gap:24px}
.people li{break-inside:avoid;padding:6px 0;border-bottom:1px solid #e5decf}.people li span{color:#6b6456;font-size:14px;margin-left:6px}
.note{color:#6b6456;font-size:14px;margin:10px 16px 0}
.card{display:none;position:fixed;inset:0;z-index:5;overflow:auto;padding:16px;background:rgba(42,38,32,.5)}
.card:target{display:block}
.sheet{position:relative;max-width:640px;margin:0 auto;padding:20px;border-radius:14px;background:#f7f3ea}
.sheet h2{font-size:24px;padding-right:44px;overflow-wrap:anywhere}.sheet h3{font-size:17px;margin:18px 0 6px}.sheet h4{font-size:16px;margin:12px 0 4px}.sheet p{margin:0 0 6px;overflow-wrap:anywhere}
.close{position:absolute;top:10px;right:10px;width:44px;height:44px;display:grid;place-items:center;border-radius:50%;font-size:24px;text-decoration:none;background:#efe8d9}
.who{display:flex;align-items:center;gap:14px;margin-bottom:10px}.who svg{flex:none;width:72px;height:72px;border-radius:50%}
.soft{color:#6b6456}.links{margin:0;padding:0;list-style:none}.links li{padding:3px 0;overflow-wrap:anywhere}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
figure{margin:0}figcaption{font-size:13px;color:#6b6456;overflow-wrap:anywhere}.photo{width:100%;background:#efe8d9 center/contain no-repeat;border-radius:8px}
footer{padding:20px 16px 32px;color:#6b6456;font-size:14px}
`

const SCRIPT = `
(function(){
var box=document.getElementById('chart'),svg=box&&box.querySelector('svg');
var tools=document.getElementById('tools');if(tools)tools.hidden=false;
if(svg){
 var W=+svg.getAttribute('width'),H=+svg.getAttribute('height'),z=1;
 function size(next){var cx=(box.scrollLeft+box.clientWidth/2)/z,cy=(box.scrollTop+box.clientHeight/2)/z;z=Math.min(1.5,Math.max(.2,next));svg.setAttribute('width',W*z);svg.setAttribute('height',H*z);box.scrollLeft=cx*z-box.clientWidth/2;box.scrollTop=cy*z-box.clientHeight/2}
 z=Math.min(1,Math.max(.65,box.clientWidth/W));svg.setAttribute('width',W*z);svg.setAttribute('height',H*z);box.scrollLeft=(W*z-box.clientWidth)/2;
 document.getElementById('in').onclick=function(){size(z*1.25)};
 document.getElementById('out').onclick=function(){size(z/1.25)};
}
var q=document.getElementById('q'),rows=[].slice.call(document.querySelectorAll('.people li'));
if(q)q.oninput=function(){var s=q.value.trim().toLowerCase(),first;rows.forEach(function(r){var on=!s||r.textContent.toLowerCase().indexOf(s)>=0;r.hidden=!on;if(on&&!first)first=r});if(s&&first)first.closest('.people').scrollIntoView()};
addEventListener('keydown',function(e){if(e.key==='Escape'&&location.hash.indexOf('#p-')===0)location.hash='_'});
document.addEventListener('click',function(e){if(e.target.classList&&e.target.classList.contains('card'))location.hash='_'});
})();
`

export interface FamilyFileStats { people: number; hidden: number; photos: number; photosLeftOut: number; bytes: number }

export async function buildFamilyFile(actor: Actor): Promise<{ html: string; filename: string; stats: FamilyFileStats }> {
  requireRole(actor, 'owner')
  // Nobody in particular: not even the owner's own card is opened, because this file travels.
  const reader: Actor = { userId: 'family-file', name: '', role: 'reader', personId: null }
  const lang = archiveLang()
  const t = (k: string) => translate(lang, k)
  const graph: Graph = getGraph(reader)
  const familyName = getSetting('familyName') ?? ''
  const pins = listViews(reader).find((v) => v.id === MAIN_VIEW)?.pins ?? {}
  // Ancestors on top: the first screen shows people by name, not the youngest, who are mostly hidden.
  const layout = layoutFamily(graph, { rootsBelow: false, pins, print: true })
  const byId = new Map(graph.persons.map((p) => [p.id, p]))
  const seen = graph.persons.filter((p) => !p.hidden)
  const nameOf = (p: Person) => personName(p) || t('Без имени')

  // Pictures first: each goes in once, however many people it shows.
  const avatars = new Map<string, string>()
  for (const p of seen) {
    if (!p.avatarMediaId || !canSeeMedia(reader, p.avatarMediaId)) continue
    try { avatars.set(p.id, dataUri('image/webp', await readAvatar(p.avatarMediaId, p.avatarCrop))) } catch { /* A missing photo leaves a plain circle. */ }
  }
  const stored = new Map<string, { uri: string; ratio: number }>()
  const leftOut = new Set<string>()
  const photosOf = new Map<string, { id: string; caption: string; date: string; place: string }[]>()
  let used = 0
  for (const p of seen) {
    const shown: { id: string; caption: string; date: string; place: string }[] = []
    for (const m of listPersonMedia(reader, p.id).filter((m) => m.kind === 'image').slice(0, PHOTOS_PER_PERSON)) {
      if (!stored.has(m.id) && !leftOut.has(m.id)) {
        try {
          let file = await readMediaFile(reader, m.id, 'medium')
          if (used + file.data.length > PHOTO_BUDGET) file = await readMediaFile(reader, m.id, 'thumb')
          if (used + file.data.length > PHOTO_BUDGET) { leftOut.add(m.id); continue }
          used += file.data.length
          stored.set(m.id, { uri: dataUri(file.mime, file.data), ratio: m.width && m.height ? m.width / m.height : 4 / 3 })
        } catch { leftOut.add(m.id); continue }
      }
      if (stored.has(m.id)) shown.push({ id: m.id, caption: m.caption, date: m.date, place: m.place })
    }
    if (shown.length) photosOf.set(p.id, shown)
  }

  const pagesOf = Map.groupBy(readablePages(reader), (page) => page.personId)
  const parents = (id: string) => graph.parentChild.filter((l) => l.childId === id).map((l) => l.parentId)
  const children = (id: string) => graph.parentChild.filter((l) => l.parentId === id).map((l) => l.childId)
  const partners = (id: string) => graph.unions.filter((u) => u.aId === id || u.bId === id).map((u) => (u.aId === id ? u.bId : u.aId))
  const relative = (id: string) => {
    const r = byId.get(id)
    if (!r) return ''
    return r.hidden ? `<li class="soft">${esc(t('Живой родственник'))}</li>` : `<li><a href="#p-${esc(r.id)}">${esc(nameOf(r))}</a></li>`
  }
  const group = (title: string, ids: string[]) => {
    const rows = [...new Set(ids)].map(relative).join('')
    return rows && `<h3>${esc(title)}</h3><ul class="links">${rows}</ul>`
  }

  // The chart. Lines first, so that names stand on top of them.
  const { x, y, w, h } = layout.bounds
  const pad = 40
  const edges = layout.edges.map((e) => `<path class="line${e.style === 'solid' ? '' : ' dash'}" d="${esc(e.path)}"/>`).join('')
  const unions = layout.unions.map((u) => `<path class="line" d="${esc(u.path)}"/><circle class="dot" cx="${u.x}" cy="${u.y}" r="4"/>`).join('')
  const defs = [...avatars].map(([id, uri]) => `<image id="a-${esc(id)}" href="${uri}" x="${-AVATAR}" y="${-AVATAR}" width="${AVATAR * 2}" height="${AVATAR * 2}"/>`).join('')
  const face = (p: Person) => {
    if (avatars.has(p.id)) return `<use href="#a-${esc(p.id)}" clip-path="url(#round)"/>`
    const first = [...nameOf(p)][0] ?? ''
    return first && `<text class="mark" y="7">${esc(first)}</text>`
  }
  const cards = [...layout.cards.values()].map((c) => {
    const p = byId.get(c.id)
    if (!p) return ''
    const at = `transform="translate(${c.x} ${c.y + AVATAR_CY})"`
    // A hidden card is an empty circle: the same words under fourteen of them would say nothing fourteen times.
    if (p.hidden) return `<g ${at}><title>${esc(t('Живой родственник'))}</title><circle class="ring U" r="${AVATAR + 3}"/></g>`
    const years = lifeYears(p)
    let dy = AVATAR + 20
    const text = lines(nameOf(p)).map((line) => { const out = `<text class="name" y="${dy}">${esc(line)}</text>`; dy += 18; return out }).join('')
    const body = `<circle class="ring ${esc(p.sex)}" r="${AVATAR + 3}"/>${face(p)}${text}${years ? `<text class="years" y="${dy}">${esc(years)}</text>` : ''}`
    return `<a href="#p-${esc(p.id)}" ${at}>${body}</a>`
  }).join('')
  const chart = `<svg xmlns="http://www.w3.org/2000/svg" width="${w + pad * 2}" height="${h + pad * 2}" viewBox="${x - pad} ${y - pad} ${w + pad * 2} ${h + pad * 2}" role="img" aria-label="${esc(t('Схема семьи'))}"><defs><clipPath id="round"><circle r="${AVATAR}"/></clipPath>${defs}</defs>${edges}${unions}${cards}</svg>`

  // One card a person: plain HTML shown by the address, so it works where a viewer runs no scripts.
  const cardsHtml = seen.map((p) => {
    const facts = p.facts.map((f) => `<p>${esc([f.kind, f.date, f.place].filter(Boolean).join(', '))}${f.note ? `<br><span class="soft">${esc(f.note)}</span>` : ''}</p>`).join('')
    const sources = p.sources.map((s) => {
      const text = [s.title, s.ref, s.page].filter(Boolean).join(', ') || s.url
      const url = webLink(s.url)
      return `<li>${url ? `<a href="${esc(url)}" rel="noopener noreferrer">${esc(text)}</a>` : esc(text)}</li>`
    }).join('')
    const pages = (pagesOf.get(p.id) ?? []).map((page) => `${page.title ? `<h3>${esc(page.title)}</h3>` : ''}${pageHtml(page.content)}`).join('')
    const photos = (photosOf.get(p.id) ?? []).map((m) => {
      const caption = [m.caption, m.date, m.place].filter(Boolean).join(', ')
      return `<figure><div class="photo m-${esc(m.id)}" role="img" aria-label="${esc(caption || nameOf(p))}" style="aspect-ratio:${stored.get(m.id)!.ratio.toFixed(3)}"></div>${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`
    }).join('')
    const places = [p.birthPlace && `${t('Место рождения')}: ${p.birthPlace}`, p.deathPlace && `${t('Место смерти')}: ${p.deathPlace}`].filter(Boolean).map((s) => `<p>${esc(s as string)}</p>`).join('')
    const other = [p.maidenName && `${t('Девичья фамилия')}: ${p.maidenName}`, p.otherNames && `${t('Другие имена')}: ${p.otherNames}`].filter(Boolean).map((s) => `<p class="soft">${esc(s as string)}</p>`).join('')
    return `<article class="card" id="p-${esc(p.id)}"><div class="sheet"><a class="close" href="#_" aria-label="${esc(t('Закрыть'))}">×</a>
<div class="who">${avatars.has(p.id) ? `<svg viewBox="${-AVATAR} ${-AVATAR} ${AVATAR * 2} ${AVATAR * 2}" aria-hidden="true"><use href="#a-${esc(p.id)}"/></svg>` : ''}<div><h2>${esc([p.givenName, p.patronymic, p.surname].filter(Boolean).join(' ') || nameOf(p))}</h2><p class="soft">${esc(lifeYears(p))}</p></div></div>
${other}${places}${group(t('Родители'), parents(p.id))}${group(t('Супруги'), partners(p.id))}${group(t('Дети'), children(p.id))}
${facts && `<h3>${esc(t('События'))}</h3>${facts}`}${pages}${photos && `<h3>${esc(t('Фотографии'))}</h3><div class="photos">${photos}</div>`}
${sources && `<h3>${esc(t('Источники'))}</h3><ul class="links">${sources}</ul>`}</div></article>`
  }).join('\n')

  const collator = new Intl.Collator(lang)
  const list = [...seen].sort((a, b) => collator.compare(`${a.surname} ${a.givenName}`, `${b.surname} ${b.givenName}`))
    .map((p) => `<li><a href="#p-${esc(p.id)}">${esc(nameOf(p))}</a>${lifeYears(p) ? `<span>${esc(lifeYears(p))}</span>` : ''}</li>`).join('')
  const hiddenCount = graph.persons.length - seen.length
  const photoCss = [...stored].map(([id, m]) => `.m-${id}{background-image:url(${m.uri})}`).join('\n')
  const today = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
  const title = familyName || t('Семейный архив')

  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>${STYLE}${photoCss}</style></head>
<body>
<header><h1>${esc(title)}</h1><p>${seen.length} ${esc(t('чел.'))} · ${esc(today)}</p></header>
<div class="tools" id="tools" hidden><input id="q" type="search" placeholder="${esc(t('Найти человека'))}" aria-label="${esc(t('Найти человека'))}"><button id="out" type="button" aria-label="${esc(t('Уменьшить'))}">−</button><button id="in" type="button" aria-label="${esc(t('Увеличить'))}">+</button></div>
<div class="chart" id="chart">${chart}</div>
${hiddenCount ? `<p class="note">${esc(t('Пустые кружки на схеме: живые родственники, они скрыты.'))}</p>` : ''}
<section class="people"><h2>${esc(t('Все люди'))}</h2><ul>${list}</ul></section>
${cardsHtml}
<footer>${esc(t('Этот файл открывается без интернета и регистрации.'))} ${esc(t('Сделано в'))} <a href="${PROJECT_URL}" rel="noopener noreferrer">Folkbranch</a></footer>
<script>${SCRIPT}</script>
</body></html>
`
  const stats: FamilyFileStats = { people: seen.length, hidden: hiddenCount, photos: stored.size, photosLeftOut: leftOut.size, bytes: Buffer.byteLength(html) }
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim().slice(0, 80) || 'family'
  return { html, filename: `${safe}.html`, stats }
}
