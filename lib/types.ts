export type Role = 'owner' | 'editor' | 'reader'
export type Sex = 'M' | 'F' | 'U'
export type Certainty = 'documented' | 'family' | 'assumed'
export type ParentKind = 'birth' | 'adopted' | 'step'
export type UnionKind = 'marriage' | 'civil'
export type Lang = 'ru' | 'en'

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
}

export interface Fact {
  kind: string
  date: string
  place: string
  note: string
  source?: string
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
  personId: string
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
  summary: string
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

export function lifeYears(p: Person, unknown = '?'): string {
  const b = p.birthDate || (p.birthYear ? String(p.birthYear) : '')
  const d = p.deathDate || (p.deathYear ? String(p.deathYear) : '')
  if (p.living) return b
  if (!b && !d) return ''
  return `${b || unknown} – ${d || unknown}`
}

/** First number that looks like a year: "~1876" → 1876, "1883 или 1886" → 1883. */
export function yearOf(date: string): number | null {
  const m = date.match(/\b(\d{4})\b/) ?? date.match(/(\d{3,4})/)
  return m ? Number(m[1]) : null
}
