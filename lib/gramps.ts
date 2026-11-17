// Gramps' own export (.gramps is this XML, gzipped; the browser unpacks it). Its GEDCOM loses place names and
// hierarchy, so a Gramps user gets more from this. Read into the shape parseGedcom gives, so one import writes both.
import type { Fact, Lang, PlaceName, Source } from './types'
import { eventWord, FACT_TAGS, gedCoord, roleWord, type Imported, type ImportedPerson } from './gedcom'
import { translatePair } from './i18n'
import { splitPatronymic } from './names'
import { PLACE_KINDS } from './places'
import { isGrampsXml } from './import-formats'

export { isGrampsXml }

export interface XmlNode { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescape = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1); return Number.isFinite(n) ? String.fromCodePoint(n) : m }
  return ENTITIES[e.toLowerCase()] ?? m
})

/** Enough XML for Gramps: elements, attributes, text, comments, CDATA. Prefixes are dropped; no DTD is read. */
export function parseXml(text: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  for (let m; (m = re.exec(text)); ) {
    const top = stack[stack.length - 1]
    if (m[1] !== undefined) top.text += m[1]
    else if (m[2]) { if (stack.length > 1) stack.pop() }
    else if (m[3]) {
      const attrs: Record<string, string> = {}
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].replace(/^.*:/, '')] = unescape(a[2] ?? a[3] ?? '')
      const node: XmlNode = { name: m[3].replace(/^.*:/, ''), attrs, children: [], text: '' }
      top.children.push(node)
      if (!m[5]) stack.push(node)
    } else if (m[6]) top.text += unescape(m[6])
  }
  return root
}


const kid = (n: XmlNode | undefined, name: string) => n?.children.find((c) => c.name === name)
const kids = (n: XmlNode | undefined, name: string) => n?.children.filter((c) => c.name === name) ?? []
const textOf = (n: XmlNode | undefined): string => (n ? n.text + n.children.map(textOf).join('') : '')
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** "1890-03-12" → "12.03.1890"; a Gramps date may leave out the day or month, or write them as 00. */
function isoDate(v: string) {
  const m = v.trim().match(/^(-?\d{1,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/)
  if (!m) return v.trim()
  const [, y, mo, d] = m
  const part = (x?: string) => (x && +x ? x.padStart(2, '0') + '.' : '')
  return `${+mo ? part(d) : ''}${part(mo)}${y}`
}

/** The date of an event or a name, in the archive's way of writing: ~ about, < before, > after, a–b a range. */
export function grampsDate(n: XmlNode | undefined): string {
  if (!n) return ''
  const val = kid(n, 'dateval'), range = kid(n, 'daterange') ?? kid(n, 'datespan'), str = kid(n, 'datestr')
  if (val) {
    const type = val.attrs.type ?? '', quality = val.attrs.quality ?? ''
    const mark = type === 'before' ? '<' : type === 'after' ? '>' : type === 'about' || quality === 'estimated' || quality === 'calculated' ? '~' : ''
    return mark + isoDate(val.attrs.val ?? '')
  }
  if (range) {
    const a = isoDate(range.attrs.start ?? ''), b = isoDate(range.attrs.stop ?? '')
    return a && b ? `${a}–${b}` : a ? `>${a}` : b ? `<${b}` : ''
  }
  return str ? clean(str.attrs.val ?? '') : ''
}

/** The years a date covers, for choosing a place name valid then: [from, to], either open. */
function yearSpan(n: XmlNode | undefined): [number | null, number | null] | null {
  const val = kid(n, 'dateval'), range = kid(n, 'daterange') ?? kid(n, 'datespan')
  const y = (s?: string) => { const m = s?.match(/^-?\d{1,4}/); return m ? +m[0] : null }
  if (val) {
    const v = y(val.attrs.val)
    if (v === null) return null
    return val.attrs.type === 'before' ? [null, v] : val.attrs.type === 'after' ? [v, null] : [v, v]
  }
  if (range) return [y(range.attrs.start), y(range.attrs.stop)]
  return null
}
const within = (span: [number | null, number | null] | null, year: number) => !!span && (span[0] === null || year >= span[0]) && (span[1] === null || year <= span[1])

/** "-48.45", "48.45", "N48.45", "48°27'00\"N": Gramps keeps what was typed and accepts all of these. */
export function grampsPoint(lat = '', lon = '') {
  const dms = (s: string) => {
    const m = s.trim().match(/^([NSEW])?\s*(-?\d+(?:[.,]\d+)?)\s*[°:]\s*(?:(\d+(?:[.,]\d+)?)\s*['′:]?\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:["″]|'')?\s*)?([NSEW])?$/i)
    if (!m) return s.replace(/\s+/g, '')
    const n = (x?: string) => Number((x ?? '0').replace(',', '.'))
    const value = Math.abs(n(m[2])) + n(m[3]) / 60 + n(m[4]) / 3600
    const side = (m[1] ?? m[5] ?? '').toUpperCase()
    return `${m[2].startsWith('-') || side === 'S' || side === 'W' ? '-' : ''}${value.toFixed(6)}`
  }
  return gedCoord(dms(lat), dms(lon))
}

interface PlaceRec { handle: string; type: string; names: { name: string; span: ReturnType<typeof yearSpan>; years: string }[]; parents: { hlink: string; span: ReturnType<typeof yearSpan> }[]; point: { lat: number; lon: number } | null }

/** Kinds of event Gramps names in English, as the GEDCOM tag the archive already has words for. */
const GRAMPS_TAG: Record<string, string> = { 'nobility title': 'TITL', 'physical description': 'DSCR', 'baptism': 'BAPM', 'adult christening': 'CHR' }
const tagOf = (type: string) => GRAMPS_TAG[type.toLowerCase()] ?? Object.entries(FACT_TAGS).find(([, [, en]]) => en.toLowerCase() === type.toLowerCase())?.[0]

/** What a person or family holds that will not come across, named as Gramps names it. */
const READ = new Set(['gender', 'name', 'eventref', 'childof', 'parentin', 'noteref', 'citationref', 'objref', 'personref', 'father', 'mother', 'childref', 'rel', 'tagref'])

export function parseGramps(text: string, lang: Lang = 'ru'): Imported {
  const db = kid(parseXml(text), 'database')
  if (!db) throw new Error('not a Gramps XML file')
  const version = (db.attrs.xmlns ?? '').match(/xml\/([\d.]+)/)?.[1] ?? '?'
  const index = (section: string, item: string) => new Map(kids(kid(db, section), item).map((n) => [n.attrs.handle, n]))
  const notes = index('notes', 'note'), sources = index('sources', 'source'), citations = index('citations', 'citation')
  const repos = index('repositories', 'repository'), objects = index('objects', 'object'), events = index('events', 'event')
  const peopleNodes = kids(kid(db, 'people'), 'person'), familyNodes = kids(kid(db, 'families'), 'family')

  // Places: every name with the years it was used, the place it was part of, and its point.
  const places = new Map<string, PlaceRec>()
  for (const p of kids(kid(db, 'places'), 'placeobj')) {
    const names = kids(p, 'pname').map((n) => ({ name: clean(n.attrs.value ?? ''), span: yearSpan(n), years: grampsDate(n).replace(/^~/, '') })).filter((n) => n.name)
    // Gramps before 4.1 kept a single title instead of names.
    if (!names.length) { const title = clean(textOf(kid(p, 'ptitle'))) || clean(p.attrs.name ?? ''); if (title) names.push({ name: title, span: null, years: '' }) }
    const c = kid(p, 'coord')
    places.set(p.attrs.handle, { handle: p.attrs.handle, type: p.attrs.type ?? '', names, parents: kids(p, 'placeref').map((r) => ({ hlink: r.attrs.hlink, span: yearSpan(r) })), point: c ? grampsPoint(c.attrs.lat, c.attrs.long) : null })
  }
  // The primary name is the undated one, else the first; a name used in some years is the one written for an event then.
  const nameAt = (p: PlaceRec, year: number | null) => (year !== null && p.names.find((n) => n.span && within(n.span, year))) || p.names.find((n) => !n.span) || p.names[0]
  const parentAt = (p: PlaceRec, year: number | null) => (year !== null && p.parents.find((r) => within(r.span, year))) || p.parents.find((r) => !r.span) || p.parents[0]
  /** "Village, County, Country", as Gramps titles a place itself. */
  const title = (handle: string | undefined, year: number | null = null) => {
    const parts: string[] = []
    const seen = new Set<string>()
    for (let at = handle; at && !seen.has(at) && parts.length < 12; ) {
      seen.add(at)
      const p = places.get(at)
      if (!p) break
      const n = nameAt(p, year)?.name
      if (n) parts.push(n)
      at = parentAt(p, year)?.hlink
    }
    return parts.join(', ')
  }

  const noteText = (refs: XmlNode[]) => refs.map((r) => notes.get(r.attrs.hlink)).filter((n): n is XmlNode => !!n).map((n) => textOf(kid(n, 'text')).trim()).filter(Boolean)
  const sourceTitle = (s: XmlNode | undefined) => {
    if (!s) return ''
    const t = clean(textOf(kid(s, 'stitle'))) || clean(textOf(kid(s, 'sabbrev')))
    const repo = clean(textOf(kid(repos.get(kid(s, 'reporef')?.attrs.hlink ?? ''), 'rname')))
    return repo && t && !t.includes(repo) ? `${t} (${repo})` : t || repo
  }
  const cite = (ref: XmlNode): (Source & { confidence: number }) | null => {
    const c = citations.get(ref.attrs.hlink)
    if (!c) return null
    const title = sourceTitle(sources.get(kid(c, 'sourceref')?.attrs.hlink ?? ''))
    return title ? { title, ref: '', page: clean(textOf(kid(c, 'page'))), url: '', confidence: +(textOf(kid(c, 'confidence')) || 2) } : null
  }

  const xrefOf = new Map(peopleNodes.map((p, i) => [p.attrs.handle, p.attrs.id || `@G${i + 1}@`]))
  const nameOf = (n: XmlNode | undefined) => {
    const first = clean(textOf(kid(n, 'first')))
    const sur = kids(n, 'surname')
    const patro = sur.find((s) => /patronym/i.test(s.attrs.derivation ?? ''))
    const main = sur.find((s) => s !== patro && s.attrs.prim !== '0') ?? sur.find((s) => s !== patro)
    const [given, splitPatro] = splitPatronymic(first)
    return { given, patronymic: patro ? clean(textOf(patro)) : splitPatro, surname: clean(textOf(main)), nick: clean(textOf(kid(n, 'nick'))), call: clean(textOf(kid(n, 'call'))) }
  }

  // Those at an event who are not its main person: godparents, witnesses. Gathered first, since any person may name them.
  const present = new Map<string, Fact['people']>()
  for (const p of peopleNodes) for (const r of kids(p, 'eventref')) {
    const role = r.attrs.role ?? 'Primary'
    if (role === 'Primary' || role === 'Family') continue
    const list = present.get(r.attrs.hlink) ?? []
    list.push({ personId: xrefOf.get(p.attrs.handle) ?? null, name: '', role: roleWord(role, lang) })
    present.set(r.attrs.hlink, list)
  }

  const persons = peopleNodes.map((p): ImportedPerson => {
    const names = kids(p, 'name')
    const primary = names.find((n) => n.attrs.alt !== '1') ?? names[0]
    const main = nameOf(primary)
    const married = names.filter((n) => n !== primary).map((n) => ({ n, ...nameOf(n) })).find((n) => /married/i.test(n.n.attrs.type ?? ''))
    const others = names.filter((n) => n !== primary && n !== married?.n).map((n) => { const x = nameOf(n); return clean([x.given, x.patronymic, x.surname].join(' ')) }).filter(Boolean)
    const facts: Fact[] = []
    let birth: XmlNode | undefined, death: XmlNode | undefined, dead = false
    const quays: number[] = []
    for (const r of kids(p, 'eventref')) {
      if ((r.attrs.role ?? 'Primary') !== 'Primary') continue
      const e = events.get(r.attrs.hlink)
      if (!e) continue
      const type = clean(textOf(kid(e, 'type')))
      if (/^(death|burial|cremation)$/i.test(type)) dead = true
      if (type === 'Birth' && !birth) { birth = e; continue }
      if (type === 'Death' && !death) { death = e; continue }
      const tag = tagOf(type)
      const cites = kids(e, 'citationref').map(cite).filter((c) => !!c)
      const span = yearSpan(e)
      facts.push({
        kind: tag ? translatePair(lang, ...FACT_TAGS[tag]) : type || eventWord(lang),
        date: grampsDate(e), place: title(kid(e, 'place')?.attrs.hlink, span?.[0] ?? span?.[1] ?? null),
        note: [clean(textOf(kid(e, 'description'))), ...noteText(kids(e, 'noteref'))].filter(Boolean).join('\n'),
        source: cites[0]?.title ?? '',
        ...(present.get(r.attrs.hlink)?.length ? { people: present.get(r.attrs.hlink) } : {}),
      })
    }
    const vital = (e: XmlNode | undefined) => {
      if (!e) return { date: '', place: '' }
      for (const c of kids(e, 'citationref')) { const q = cite(c); if (q) quays.push(q.confidence) }
      const span = yearSpan(e)
      return { date: grampsDate(e), place: title(kid(e, 'place')?.attrs.hlink, span?.[0] ?? span?.[1] ?? null) }
    }
    const b = vital(birth), d = vital(death)
    const own = [...kids(p, 'citationref'), ...kids(primary, 'citationref')].map(cite).filter((c) => !!c)
    for (const c of own) quays.push(c.confidence)
    const seen = new Set<string>()
    const gender = clean(textOf(kid(p, 'gender')))
    return {
      xref: xrefOf.get(p.attrs.handle)!,
      givenName: main.given,
      surname: married?.surname && married.surname !== main.surname ? married.surname : main.surname,
      maidenName: married?.surname && married.surname !== main.surname ? main.surname : '',
      patronymic: main.patronymic,
      otherNames: [...new Set([main.nick, main.call && main.call !== main.given ? main.call : '', ...others].filter(Boolean))].join(', '),
      sex: gender === 'M' ? 'M' : gender === 'F' ? 'F' : 'U',
      birthDate: b.date, birthPlace: b.place, deathDate: d.date, deathPlace: d.place,
      dead: dead || !!death,
      keepPrivate: p.attrs.priv === '1',
      noChildren: false, neverMarried: false,
      // Gramps' "normal" confidence is its default, written on every citation: like its GEDCOM export, it says nothing.
      quality: quality(quays),
      notes: noteText(kids(p, 'noteref')),
      facts,
      sources: own.map((c): Source => ({ title: c.title, ref: c.ref, page: c.page, url: c.url })).filter((s) => { const k = JSON.stringify(s); return !seen.has(k) && !!seen.add(k) }),
      media: kids(p, 'objref').map((r) => objects.get(r.attrs.hlink)).filter((o): o is XmlNode => !!o).map((o) => ({ file: kid(o, 'file')?.attrs.src ?? '', title: kid(o, 'file')?.attrs.description ?? '' })).filter((m) => m.file),
    }
  })
  // A participant who is in the file keeps the name it has there, until the import links the card.
  const named = new Map(persons.map((p) => [p.xref, [p.givenName, p.patronymic, p.surname].filter(Boolean).join(' ')]))
  for (const p of persons) for (const f of p.facts) for (const x of f.people ?? []) if (x.personId) x.name = named.get(x.personId) ?? ''

  const families: Imported['families'] = familyNodes.map((f) => {
    const evs = kids(f, 'eventref').map((r) => events.get(r.attrs.hlink)).filter((e): e is XmlNode => !!e)
    const marr = evs.find((e) => clean(textOf(kid(e, 'type'))) === 'Marriage')
    const div = evs.find((e) => clean(textOf(kid(e, 'type'))) === 'Divorce')
    const span = yearSpan(marr)
    return {
      husb: xrefOf.get(kid(f, 'father')?.attrs.hlink ?? ''),
      wife: xrefOf.get(kid(f, 'mother')?.attrs.hlink ?? ''),
      children: kids(f, 'childref').map((c) => ({ xref: xrefOf.get(c.attrs.hlink) ?? '', adopted: c.attrs.frel === 'Adopted' || c.attrs.mrel === 'Adopted' })).filter((c) => c.xref),
      date: grampsDate(marr), end: div ? grampsDate(div) || '?' : '',
      place: marr ? title(kid(marr, 'place')?.attrs.hlink, span?.[0] ?? span?.[1] ?? null) : '',
      kind: kid(f, 'rel')?.attrs.type === 'Civil Union' ? 'civil' : 'marriage',
      hasEvent: !!marr,
    }
  })

  // Every place of the file, with what it was part of, parents first so a child finds its parent's record.
  const order: PlaceRec[] = []
  const placed = new Set<string>()
  const visit = (p: PlaceRec, depth = 0) => {
    if (placed.has(p.handle) || depth > 12) return
    placed.add(p.handle)
    const up = parentAt(p, null)
    const parent = up && places.get(up.hlink)
    if (parent) visit(parent, depth + 1)
    order.push(p)
  }
  places.forEach((p) => visit(p))
  const placeList: Imported['places'] = order.filter((p) => p.names.length).map((p) => {
    const primary = nameAt(p, null)!
    const parent = parentAt(p, null)?.hlink
    return {
      text: title(p.handle), lat: p.point?.lat ?? null, lon: p.point?.lon ?? null,
      name: primary.name, kind: placeKind(p.type), parent: parent && places.has(parent) ? title(parent) : undefined,
      otherNames: p.names.filter((n) => n !== primary).map((n): PlaceName => ({ name: n.name, years: n.years })),
    }
  })

  const unread = new Map<string, number>()
  for (const n of [...peopleNodes, ...familyNodes]) for (const c of n.children) if (!READ.has(c.name)) unread.set(c.name, (unread.get(c.name) ?? 0) + 1)
  return { version: `Gramps XML ${version}`, persons, families, places: placeList, unread: [...unread].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count) }
}

/** Gramps rates a citation 0 (very low) to 4 (very high); as GEDCOM's QUAY, the way Gramps' own GEDCOM export writes it. */
function quality(confidences: number[]) {
  const quay = confidences.filter((c) => c !== 2).map((c) => (c >= 4 ? 3 : c === 3 ? 2 : c))
  return quay.length ? Math.max(...quay) : null
}

/** Gramps' place types as the kinds the Places list offers; a type typed in Russian that is one of them stays. */
const KINDS: Record<string, string> = {
  country: 'Страна', state: 'Область', province: 'Губерния', region: 'Область', department: 'Область', county: 'Уезд', district: 'Район',
  municipality: 'Район', city: 'Город', town: 'Город', village: 'Деревня', hamlet: 'Деревня', parish: 'Приход', locality: 'Посёлок',
}
const placeKind = (type: string) => KINDS[type.toLowerCase()] ?? PLACE_KINDS.find((k) => k.toLowerCase() === type.toLowerCase()) ?? ''
