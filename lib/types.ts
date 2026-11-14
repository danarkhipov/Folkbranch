export type Role = 'owner' | 'editor' | 'reader'
export type Sex = 'M' | 'F' | 'U'
export type Certainty = 'documented' | 'family' | 'assumed'
export type ParentKind = 'birth' | 'adopted' | 'step'
export type UnionKind = 'marriage' | 'civil'
export type Lang = 'ru' | 'en' | 'es' | 'ca'

export interface Person {
  id: string
  givenName: string
  surname: string
  maidenName: string
  patronymic: string
  otherNames: string
  sex: Sex
  birthDate: string
  birthYear: number | null
  birthPlace: string
  deathDate: string
  deathYear: number | null
  deathPlace: string
  living: boolean
  /** Hidden from readers like the living. */
  keepPrivate?: boolean
  /** Known to have had no children, or never to have married: not the same as not knowing. */
  noChildren?: boolean
  neverMarried?: boolean
  certainty: Certainty
  avatarMediaId: string | null
  avatarCrop: string | null
  updatedAt: number
  /** Living relative hidden from a reader: position in the graph only, no data. */
  hidden?: boolean
  tags: string[]
  facts: Fact[]
  sources: Source[]
  claims: Claim[]
}

export type ClaimField = 'birthDate' | 'birthPlace' | 'deathDate' | 'deathPlace' | 'givenName' | 'patronymic' | 'surname' | 'maidenName'
export type Reliability = 'original' | 'copy' | 'transcript' | 'witness' | 'hearsay' | 'guess'

export interface Claim {
  id: string
  field: ClaimField
  value: string
  sourceId: string | null
  status: 'accepted' | 'possible' | 'rejected'
  /** Why it was rejected. */
  reason: string
  at: number
}

export interface Source {
  id?: string
  reliability?: Reliability
  /** The archive, book or person it comes from. */
  title: string
  /** Fond, inventory and file, or any other reference. */
  ref: string
  /** Sheet or page. */
  page: string
  url: string
  /** The entry within the source: its number in a church book, a line in a census. */
  record?: string
  /** When the document itself was written, not the event it records. */
  date?: string
  /** The words of the record as read, kept beside the image they come from. */
  transcription?: string
  /** Where the source is kept, among the archive's repositories. */
  repositoryId?: string
}

export interface PlaceName { name: string; years: string }
export interface Place { id: string; name: string; kind: string; parentId: string | null; otherNames: PlaceName[]; lat: number | null; lon: number | null; note: string }
export interface Repository { id: string; name: string; address: string; url: string; note: string }
export interface Contacts { phone: string; email: string; address: string; note: string }

export interface Fact {
  /** Set when the fact is added in the app, so two devices editing one fact can tell it apart. */
  id?: string
  kind: string
  date: string
  place: string
  note: string
  source?: string
  /** What the kind asks for besides: a unit and a rank, a height. Keys are those in lib/fact-kinds. */
  fields?: Record<string, string>
  /** Who else was there, and as whom: godparents, witnesses, the priest. */
  people?: FactPerson[]
}

/** Someone at an event, with a card or only a name as the record gives it. */
export interface FactPerson {
  personId: string | null
  name: string
  role: string
}

export interface ParentLink {
  id: string
  parentId: string
  childId: string
  kind: ParentKind
  certainty: Certainty
}

export interface Union {
  id: string
  aId: string
  bId: string
  kind: UnionKind
  startDate: string
  endDate: string
  place: string
  certainty: Certainty
}

export interface Graph {
  persons: Person[]
  parentChild: ParentLink[]
  unions: Union[]
}

/** Whether this person can talk to the assistant now, and if not, why. */
export type AssistantState = { ready: true } | { ready: false; reason: 'no-key' | 'off' | 'readers'; canFix: boolean }

export interface Me {
  id: string
  name: string
  role: Role
  personId: string | null
  /** Came through a link for viewing and has no account. */
  guest?: boolean
}

export interface PageMeta {
  id: string
  personId: string
  parentPageId: string | null
  title: string
  icon: string
  position: number
  updatedAt: number
}

export interface Page extends PageMeta {
  content: string
}

export interface MediaTag {
  id: string
  mediaId: string
  /** Empty for someone without a card; `label` then says who. */
  personId: string | null
  label: string | null
  x: number | null
  y: number | null
  w: number | null
  h: number | null
}

export interface Media {
  id: string
  kind: 'image' | 'file'
  originalName: string
  mime: string
  width: number
  height: number
  caption: string
  date: string
  place: string
  createdAt: number
  tags: MediaTag[]
}

export interface HistoryEntry {
  id: string
  at: number
  actorName: string
  userId: string
  /** Made through a key by a program, not by a person in the app. */
  byAgent: boolean
  summary: string
  /** What exactly changed, in words. Not sent to readers. */
  details?: { label: string; before: string | null; after: string | null }[]
  personIds: string[]
  undoOf: string | null
  undoneAt: number | null
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export const personName = (p: Pick<Person, 'givenName' | 'surname'>) =>
  [p.givenName, p.surname].filter(Boolean).join(' ').trim()

let serverOpenEnd: (() => string) | null = null
/** The server says how a living person's open range ends in the archive's language; a browser reads the language of its page. */
export const setOpenEnd = (f: () => string) => { serverOpenEnd = f }
/** The page's own word for it: this file cannot reach the tables. The server's word comes from 'н. в.' in them. A language not here reads 'now'. */
const OPEN_END: Partial<Record<Lang, string>> = { ru: 'н. в.', en: 'now', es: 'hoy', ca: 'avui' }
const openEnd = () => (typeof document !== 'undefined' ? (OPEN_END[document.documentElement.lang.slice(0, 2) as Lang] ?? 'now') : serverOpenEnd?.() ?? 'н. в.')

export function lifeYears(p: Person, unknown = '?', open: string = openEnd()): string {
  const b = p.birthDate || (p.birthYear ? String(p.birthYear) : '')
  const d = p.deathDate || (p.deathYear ? String(p.deathYear) : '')
  // One date alone would not say whether it is a birth or a death, so a living person's range stays open.
  if (p.living) return b ? `${b} – ${open}` : ''
  if (!b && !d) return ''
  return `${b || unknown} – ${d || unknown}`
}

/** First number that looks like a year: "~1876" → 1876, "1883 или 1886" → 1883. */
export function yearOf(date: string): number | null {
  const m = date.match(/\b(\d{4})\b/) ?? date.match(/(\d{3,4})/)
  return m ? Number(m[1]) : null
}

/** Someone's words. Not a fact, even when it is the only thing known. */
export interface Story {
  id: string
  title: string
  body: string
  tellerId: string | null
  tellerName: string
  toldOn: string
  about: string[]
  hasAudio: boolean
  durationSec: number | null
  /** Seen by editors only; never sent to a reader. */
  keepPrivate?: boolean
  createdBy: string
  createdAt: number
  updatedAt: number
}

/** Groups a person can see. A `case:` tag only remembers which research case a card came from. */
export const shownTags = (tags: string[]) => tags.filter((t) => !t.startsWith('case:'))
