// Files that come with a tree: which person each belongs to, from what the tree says and from how the file is named.
import { normal } from './search/words'
import type { Lang } from './types'

export interface FilePerson { xref: string; name: string; year?: number | null }
export interface FileLink { xref: string; file: string; title?: string }
export interface Matched { name: string; xrefs: string[]; how: 'link' | 'id' | 'name' | null }

const base = (path: string) => path.split(/[\\/]/).pop() ?? path
const plain = (s: string) => s.toLowerCase().replace(/ё/g, 'е')
const stem = (s: string) => plain(base(s)).replace(/\.[a-z0-9]{1,5}$/i, '')
const words = (s: string) => plain(s).split(/[^a-zа-я0-9]+/).filter(Boolean)

/** A name that is a path ("photos/ivan.jpg") is matched by its last parts too. */
const tail = (path: string, n: number) => plain(path).split(/[\\/]/).slice(-n).join('/')

/**
 * 1. The tree links the file to people (OBJE), by the file's name or the end of its path.
 * 2. The file's name holds a person's number from the tree ("P012", "I5_wedding.jpg").
 * 3. The file's name holds every word of one person's name and of no one else's.
 */
export function matchFiles(files: { name: string; path?: string }[], people: FilePerson[], links: FileLink[], lang?: Lang): Matched[] {
  // A Spanish or Catalan archive reads a name without its accents: "Inés Peñalver" in ines_penalver.jpg.
  const fold = lang === 'es' || lang === 'ca' ? (s: string) => normal(s).replace(/ç/g, 'c') : (s: string) => s
  const byLink = new Map<string, Set<string>>()
  for (const l of links) {
    for (const key of [plain(base(l.file)), tail(l.file, 2)]) byLink.set(key, (byLink.get(key) ?? new Set()).add(l.xref))
  }
  const ids = new Map(people.map((p) => [plain(p.xref.replace(/@/g, '')), p.xref]))
  // Given name and surname: a patronymic is not always written.
  const named = people.map((p) => { const w = words(fold(p.name)).filter((x) => x.length > 2); return { xref: p.xref, words: w.length >= 2 ? [w[0], w[w.length - 1]] : [] } }).filter((p) => p.words.length)
  return files.map((f) => {
    const own = base(f.name)
    const linked = byLink.get(plain(own)) ?? (f.path ? byLink.get(tail(f.path, 2)) : undefined)
    if (linked?.size) return { name: f.name, xrefs: [...linked], how: 'link' as const }
    const token = stem(own).match(/(?:^|[^a-z0-9])([a-z]{1,2}\d{1,6})(?=$|[^a-z0-9])/i)?.[1] ?? stem(own).match(/^([a-z]{1,2}\d{1,6})/i)?.[1]
    const byId = token ? ids.get(plain(token)) : undefined
    if (byId) return { name: f.name, xrefs: [byId], how: 'id' as const }
    const inName = new Set(words(fold(stem(own))))
    const same = (w: string, x: string) => w === x || (w.length > 4 && x.length > 4 && Math.abs(w.length - x.length) <= 2 && w.slice(0, 5) === x.slice(0, 5))
    const hits = named.filter((p) => p.words.every((w) => [...inName].some((x) => same(w, x))))
    // Two people who both fit are no better than none.
    if (hits.length === 1) return { name: f.name, xrefs: [hits[0].xref], how: 'name' as const }
    return { name: f.name, xrefs: [], how: null }
  })
}

/** Which of the dropped files is the tree: the others are what goes with it. */
const TREE = /\.(ged|gedcom|csv|tsv|xlsx|json|txt|md)$/i
export function splitDropped(files: File[]) {
  const tree = files.find((f) => /\.(ged|gedcom)$/i.test(f.name)) ?? files.find((f) => TREE.test(f.name))
  return { tree: tree ?? null, rest: files.filter((f) => f !== tree) }
}
