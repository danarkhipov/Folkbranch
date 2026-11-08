// Every write that the UI, REST and MCP can make, described once. A token's writes wait in
// a draft for a person to accept; everyone else's apply at once.
import { eq,  } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../db'
import { parseFamilyText, planFamilyText, type PlannedOp } from '../textformat'
import * as claims from '../claims'
import { personName, type Certainty, type ParentKind, type UnionKind } from '../types'
import { newId, OpError, undo } from './core'
import { importGedcom } from './gedcom'
import { caseFiles, importCase } from './kinship-case'
import * as media from './media'
import * as pages from './pages'
import * as places from './places'
import * as stories from './stories'
import * as people from './people'
import { say } from './settings'
import { certainty, personInput, claimField, sourceInput, relationType, agentCreate, agentPatch, relationInput, box, blocks, markdown, type Def, def, personFor, isAgent, isTemp, assertLink, assertPlanSound, assertSpouses, checkNewPerson, checkPatch, withVersions, assertVersion, pageContent, FIELD, REL, nameOfReal, pageName } from './op-defs'

/** What a place change says to the person accepting it. */
const placeDetails = (p: { kind?: string; otherNames?: { name: string; years?: string }[]; lat?: number | null; lon?: number | null; note?: string }) => [
  p.kind,
  p.otherNames?.length ? `${say('Другие и старые названия')}: ${p.otherNames.map((n) => (n.years ? `${n.name} (${n.years})` : n.name)).join(', ')}` : '',
  p.lat != null && p.lon != null ? `${p.lat}, ${p.lon}` : '',
  p.note,
].filter((x): x is string => !!x)

export const OPS: Record<string, Def> = {
  create_person: def({
    risk: 'write',
    description: 'Create a person, optionally linked to someone at once.',
    input: z.object({ person: personInput, relation: relationInput.optional(), notDuplicate: z.boolean().optional() }),
    agentInput: z.object({ person: agentCreate, relation: relationInput.optional(), notDuplicate: z.boolean().optional().describe('Only after the person said this is someone new') }),
    creates: true,
    prepare: checkNewPerson,
    apply: (a, x) => people.createPerson(a, x.person, x.relation),
    describe: (x, c) => ({
      text: `${say('Добавить')}: ${[x.person.givenName, x.person.surname].filter(Boolean).join(' ')}`,
      details: [x.person.birthDate && `${say('дата рождения')}: ${x.person.birthDate}`, x.person.deathDate && `${say('дата смерти')}: ${x.person.deathDate}`, x.relation && `${say(REL[x.relation.type])} — ${c.name(x.relation.to)}`].filter(Boolean),
    }),
  }),
  update_person: def({
    risk: 'write',
    description: 'Change fields of a person. Only the given fields change.',
    // `seen`: each field as the editor last saw it, so a relative's edit made meanwhile is not lost.
    input: z.object({ id: z.string(), patch: personInput, seen: z.record(z.string(), z.unknown()).optional() }),
    agentInput: z.object({ id: z.string(), patch: agentPatch }),
    refs: { id: 'persons' },
    prepare: (a, x) => { checkPatch(a, x.id, x.patch); return x },
    apply: (a, x) => people.updatePerson(a, x.id, isAgent(a) ? withVersions(personFor(a, x.id), x.patch) : x.patch, x.seen),
    describe: (x, c) => {
      const cur = x.id.startsWith('tmp_') ? null : people.getPersonRow(x.id) as Record<string, unknown>
      return { text: c.name(x.id), details: Object.entries(x.patch).map(([k, v]) => `${say(FIELD[k] ?? k)}: ${cur?.[k] ?? ''} → ${v}`) }
    },
  }),
  update_people: def({
    risk: 'danger',
    description: 'Change several people as one change, undone all at once. Use this instead of many update_person calls, and only after the person agreed to the whole list.',
    input: z.object({ changes: z.array(z.object({ id: z.string(), patch: personInput })).min(1).max(200) }),
    agentInput: z.object({ changes: z.array(z.object({ id: z.string(), patch: z.record(z.string(), z.unknown()).describe('Fields as in update_person') })).min(1).max(200) }),
    bulk: true,
    expand: (a, x) => {
      if (new Set(x.changes.map((c: { id: string }) => c.id)).size !== x.changes.length) throw new OpError(400, 'the same person is listed twice')
      for (const c of x.changes) {
        agentPatch.parse(c.patch)
        if (!isTemp(c.id)) personFor(a, c.id)
        checkPatch(a, c.id, c.patch)
      }
      return x.changes.map((c: { id: string; patch: unknown }) => ({ op: 'update_person', args: c }) as PlannedOp)
    },
    summary: (x) => `${say('Изменить сразу')}: ${x.changes.length}`,
    apply: () => { throw new OpError(500, 'update_people is expanded before applying') },
    describe: () => ({ text: '' }),
  }),
  delete_person: def({
    risk: 'danger',
    description: 'Delete a person with their relations, pages and photo tags. Can be undone.',
    input: z.object({ id: z.string() }),
    refs: { id: 'persons' },
    apply: (a, x) => people.deletePerson(a, x.id),
    describe: (x, c) => ({ text: `${say('Удалить человека')}: ${c.name(x.id)}` }),
  }),
  add_relation: def({
    risk: 'write',
    description: 'Link two existing people: `other` becomes the father, mother, son, daughter or spouse of `to`.',
    input: z.object({
      type: relationType, to: z.string(), other: z.string(), otherParentId: z.string().nullish(),
      kind: z.enum(['birth', 'adopted', 'step']).optional(), certainty: certainty.optional(),
      unionKind: z.enum(['marriage', 'civil']).optional(), startDate: z.string().optional(), endDate: z.string().optional(),
    }),
    refs: { to: 'persons', other: 'persons' },
    prepare: (a, x) => {
      if (!isAgent(a) || isTemp(x.to) || isTemp(x.other)) return x
      if (x.to === x.other) throw new OpError(400, 'same person')
      const other = personFor(a, x.other)
      personFor(a, x.to)
      if (x.type === 'spouse') assertSpouses(a, x.to, x.other)
      else assertLink(a, x.type, x.to, { id: x.other, sex: other.sex, birthDate: other.birthDate, name: personName(other) }, x.kind)
      if (x.otherParentId && !isTemp(x.otherParentId)) personFor(a, x.otherParentId)
      return x
    },
    apply: (a, x) => people.linkPeople(a, x.type, x.to, x.other, x.otherParentId, { kind: x.kind as ParentKind, certainty: x.certainty as Certainty, unionKind: x.unionKind as UnionKind, startDate: x.startDate, endDate: x.endDate }),
    describe: (x, c) => ({ text: `${c.name(x.other)} — ${say(REL[x.type])}: ${c.name(x.to)}`, details: [x.startDate, x.kind && x.kind !== 'birth' && x.kind, x.certainty === 'assumed' && say('предположение')].filter(Boolean) }),
  }),
  update_relation: def({
    risk: 'write',
    description: 'Change a link: kind, certainty and, for a union, its dates and place. Link ids come from get_person.',
    input: z.object({ type: z.enum(['parent', 'union']), id: z.string(), kind: z.string().optional(), certainty: certainty.optional(), startDate: z.string().max(60).optional(), endDate: z.string().max(60).optional(), place: z.string().max(120).optional() }),
    prepare: (_a, x) => {
      const { type, id, ...patch } = x
      if (!Object.keys(patch).length) throw new OpError(400, 'nothing to change')
      const table = type === 'parent' ? schema.parentChild : schema.unions
      if (!getDb().select({ id: table.id }).from(table).where(eq(table.id, id)).get()) throw new OpError(404, `link ${id} not found`)
      if (x.kind && !(type === 'parent' ? ['birth', 'adopted', 'step'] : ['marriage', 'civil']).includes(x.kind)) throw new OpError(400, `${x.kind} is not a kind of ${type} link`)
      if (type === 'parent' && (x.startDate !== undefined || x.endDate !== undefined || x.place !== undefined)) throw new OpError(400, 'dates and place belong to a union, not a parent link')
      return x
    },
    apply: (a, { type, id, ...patch }) => people.updateRelation(a, type, id, patch),
    describe: (x) => ({ text: `${say('Связь')}: ${[x.kind, x.certainty, x.startDate, x.endDate, x.place].filter(Boolean).join(', ')}` }),
  }),
  remove_relation: def({
    risk: 'danger',
    description: 'Remove a link. Link ids come from get_person.',
    input: z.object({ type: z.enum(['parent', 'union']), id: z.string() }),
    apply: (a, x) => people.removeRelation(a, x.type, x.id),
    describe: (x) => {
      const db = getDb()
      const r = x.type === 'parent' ? db.select().from(schema.parentChild).where(eq(schema.parentChild.id, x.id)).get() : db.select().from(schema.unions).where(eq(schema.unions.id, x.id)).get()
      const ids = !r ? [] : 'parentId' in r ? [r.parentId, r.childId] : [r.aId, r.bId]
      return { text: `${say('Удалить связь')}: ${ids.map(nameOfReal).join(' — ')}` }
    },
  }),
  remove_parent_links: def({
    risk: 'danger',
    description: 'Take a child off several parents at once, as one change. Link ids come from get_person.',
    input: z.object({ ids: z.array(z.string()).min(1) }),
    apply: (a, x) => people.removeParentLinks(a, x.ids),
    describe: (x) => ({ text: `${say('Удалить связь')}: ${x.ids.length}` }),
  }),
  create_page: def({
    risk: 'write',
    description: 'Create a page about a person. Give the text as `markdown` (preferred) or BlockNote `content`.',
    input: z.object({ personId: z.string(), title: z.string().optional(), parentPageId: z.string().nullish(), icon: z.string().optional(), markdown: markdown.optional(), content: blocks.optional() }),
    refs: { personId: 'persons', parentPageId: 'pages' },
    creates: true,
    prepare: pageContent,
    apply: (a, x) => pages.createPage(a, { personId: x.personId, title: x.title, parentPageId: x.parentPageId, icon: x.icon, content: x.content }),
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${say('Новая страница')} «${x.title ?? ''}»` }),
  }),
  update_page: def({
    risk: 'write',
    description: 'Change the title, icon or text of a page. New text replaces the old one entirely. Pass baseUpdatedAt from get_page to be refused if somebody changed the page meanwhile.',
    input: z.object({ id: z.string(), title: z.string().optional(), icon: z.string().optional(), markdown: markdown.optional(), content: blocks.optional(), baseUpdatedAt: z.number().optional() }),
    refs: { id: 'pages' },
    prepare: pageContent,
    apply: (a, { id, ...patch }) => pages.updatePage(a, id, patch),
    describe: (x, c) => ({ text: `${say('Страница')}: ${pageName(x.id, c)}`, details: [x.title !== undefined && `${say('Название')}: ${x.title}`, x.content && `${x.content.length} ${say('блоков')}`].filter(Boolean) as string[] }),
  }),
  move_page: def({
    risk: 'write',
    description: 'Put a page under another page, or at the top level with parentPageId null.',
    input: z.object({ id: z.string(), parentPageId: z.string().nullable().optional(), position: z.number().optional() }),
    refs: { id: 'pages', parentPageId: 'pages' },
    apply: (a, { id, ...patch }) => pages.updatePage(a, id, patch),
    describe: (x, c) => ({ text: `${say('Страница')}: ${pageName(x.id, c)}` }),
  }),
  delete_page: def({
    risk: 'danger',
    description: 'Delete a page with its subpages. Can be undone.',
    input: z.object({ id: z.string() }),
    refs: { id: 'pages' },
    apply: (a, x) => pages.deletePage(a, x.id),
    describe: (x, c) => ({ text: `${say('Удалить')}: ${pageName(x.id, c)}` }),
  }),
  upload_photo: def({
    risk: 'write',
    description: 'Add a photo or file, by link or as base64, optionally tagged with a person.',
    input: z.object({ url: z.string().url().optional(), base64: z.string().optional(), filename: z.string().optional(), personId: z.string().nullish() }).refine((x) => !!x.url !== !!x.base64, 'give either url or base64'),
    refs: { personId: 'persons' },
    creates: true,
    prepare: async (a, x) => {
      const got = x.url ? await media.fetchRemote(x.url) : { buf: Buffer.from(x.base64, 'base64'), name: x.filename ?? 'photo' }
      return { row: await media.storeUpload(got.buf, x.filename ?? got.name, a.userId), personId: x.personId ?? null }
    },
    apply: (a, x) => media.commitUpload(a, x.row, x.personId),
    describe: (x, c) => ({ text: `${say('Загрузить фото')}: ${x.row.originalName}`, details: x.personId ? [c.name(x.personId)] : [] }),
  }),
  create_story: def({
    internal: true,
    risk: 'write',
    description: "A reader's story, waiting for review.",
    input: z.object({}).passthrough(),
    creates: true,
    apply: (a, x) => stories.createStory(a, x),
    describe: (x, c) => ({
      text: `${x.about.map((id: string) => c.name(id)).join(', ')}: ${say('Рассказ')}${x.title ? ` «${x.title}»` : ''}`,
      details: [x.tellerId ? `${say('Со слов')}: ${c.name(x.tellerId)}` : x.tellerName && `${say('Со слов')}: ${x.tellerName}`, x.toldOn, x.audio && say('С записью голоса'), x.body].filter(Boolean),
    }),
  }),
  update_photo: def({
    risk: 'write',
    description: 'Change the caption, date or place of a photo.',
    input: z.object({ id: z.string(), caption: z.string().optional(), date: z.string().optional(), place: z.string().optional() }),
    refs: { id: 'media' },
    apply: (a, { id, ...patch }) => media.updateMedia(a, id, patch),
    describe: (x) => ({ text: `${say('Подпись')}: ${x.caption ?? ''}`, details: [x.date, x.place].filter(Boolean) }),
  }),
  delete_photo: def({
    risk: 'danger',
    description: 'Delete a photo. Can be undone.',
    input: z.object({ id: z.string() }),
    refs: { id: 'media' },
    apply: (a, x) => media.deleteMedia(a, x.id),
    describe: (x) => ({ text: `${say('Удалить')}: ${say('Фото')} ${x.id}` }),
  }),
  tag_photo: def({
    risk: 'write',
    description: 'Mark someone on a photo: personId for a person in the archive, or label alone for anyone else. Never create a person just to name them on a photo. The box is in fractions of the photo size; without a box the person is simply linked.',
    input: z.object({ mediaId: z.string(), personId: z.string().nullish(), label: z.string().max(200).nullish(), box: box.nullish() }).refine((x) => x.personId || x.label?.trim(), 'personId or label is required'),
    refs: { mediaId: 'media', personId: 'persons' },
    apply: (a, x) => media.addTag(a, x.mediaId, x, x.box ?? null),
    describe: (x, c) => ({ text: `${say('Фото')}: ${x.personId ? c.name(x.personId) : x.label}` }),
  }),
  untag_photo: def({
    risk: 'danger',
    description: 'Remove a person mark from a photo. Tag ids come from list_photos.',
    input: z.object({ id: z.string() }),
    refs: { id: 'mediaTags' },
    apply: (a, x) => media.removeTag(a, x.id),
    describe: () => ({ text: `${say('Удалить')}: ${say('Фото')}` }),
  }),
  set_avatar: def({
    risk: 'write',
    description: "Use a photo, or a part of it, as a person's avatar. Null mediaId removes the avatar.",
    input: z.object({ personId: z.string(), mediaId: z.string().nullable(), crop: box.nullish() }),
    refs: { personId: 'persons', mediaId: 'media' },
    prepare: (a, x) => {
      if (x.mediaId && media.getMedia(a, x.mediaId).kind !== 'image') throw new OpError(400, 'only a picture can be an avatar')
      return x
    },
    apply: (a, x) => people.setAvatar(a, x.personId, x.mediaId, x.crop),
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${say('Сделать аватаркой')}` }),
  }),
  create_place: def({
    risk: 'write',
    description: 'Add a place: a village, town, parish or region, with what it was part of, its other and old names, and its point on a map. Look in list_places first. Give coordinates only for a place you are sure of, and say in the note where they come from.',
    input: places.placeInput,
    creates: true,
    prepare: (_a, x) => { if (x.parentId && !isTemp(x.parentId)) places.getPlace(x.parentId); return x },
    apply: (a, x) => places.savePlace(a, null, x),
    describe: (x) => ({ text: `${say('Место')}: ${x.name}`, details: placeDetails(x) }),
  }),
  update_place: def({
    risk: 'write',
    description: 'Change a place. Only the given fields change; otherNames replaces the whole list.',
    input: z.object({ id: z.string(), patch: places.placePatch }),
    prepare: (_a, x) => { if (!isTemp(x.id)) places.getPlace(x.id); return x },
    apply: (a, x) => places.savePlace(a, x.id, { ...places.getPlace(x.id), ...x.patch }),
    describe: (x) => ({ text: `${say('Место')}: ${isTemp(x.id) ? x.patch.name ?? x.id : places.getPlace(x.id).name}`, details: placeDetails(x.patch) }),
  }),
  add_version: def({
    risk: 'write',
    description: 'Record a value found for a person: birth or death date or place, or a name. Keeps what was there; the first value of an empty field becomes the main one, otherwise a person chooses. Prefer this to update_person for anything found in a source. Give `source` to say where it comes from: reuse a source by `sourceId` from get_person.',
    input: z.object({
      personId: z.string(),
      field: claimField,
      value: z.string().min(1).max(120),
      sourceId: z.string().max(40).optional(),
      source: sourceInput.optional().describe('A new source for this person'),
    }),
    refs: { personId: 'persons' },
    apply: (a, x) => {
      const p = personFor(a, x.personId)
      const source = x.source ? { ...x.source, id: newId(), ref: x.source.ref ?? '', page: x.source.page ?? '', url: x.source.url ?? '' } : null
      const sources = source ? [...p.sources, source] : p.sources
      if (x.sourceId && !sources.some((s) => s.id === x.sourceId)) throw new OpError(404, `source ${x.sourceId} not found on this person`)
      return people.updatePerson(a, x.personId, { sources, ...claims.addVersion({ ...p, sources }, x.field, x.value, source?.id ?? x.sourceId ?? null) })
    },
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${x.field} = ${x.value}`, details: [x.source?.title].filter(Boolean) }),
  }),
  add_source: def({
    risk: 'write',
    description: 'Add a source to a person: an archive, a book or who told it. The answer has its sourceId, for add_version.',
    input: z.object({ personId: z.string() }).extend(sourceInput.shape),
    refs: { personId: 'persons' },
    apply: (a, { personId, ...s }) => {
      const p = personFor(a, personId)
      const source = { ...s, id: newId(), ref: s.ref ?? '', page: s.page ?? '', url: s.url ?? '' }
      people.updatePerson(a, personId, { sources: [...p.sources, source] })
      return { sourceId: source.id }
    },
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${x.title}`, details: [x.ref, x.page].filter(Boolean) }),
  }),
  remove_source: def({
    risk: 'danger',
    description: 'Remove a source from a person. Source ids come from get_person. Refused while a version of a value relies on it.',
    input: z.object({ personId: z.string(), sourceId: z.string() }),
    refs: { personId: 'persons' },
    apply: (a, x) => {
      const p = personFor(a, x.personId)
      if (!p.sources.some((s) => s.id === x.sourceId)) throw new OpError(404, `source ${x.sourceId} not found on this person`)
      const user = p.claims.find((c) => c.sourceId === x.sourceId)
      if (user) throw new OpError(409, `the version ${user.value} of ${user.field} relies on this source`)
      people.updatePerson(a, x.personId, { sources: p.sources.filter((s) => s.id !== x.sourceId) })
    },
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${say('Удалить')} ${x.sourceId}` }),
  }),
  restore_version: def({
    risk: 'write',
    description: 'Bring back a version marked as wrong. Version ids come from get_person (`claims`).',
    input: z.object({ personId: z.string(), field: claimField, versionId: z.string() }),
    refs: { personId: 'persons' },
    apply: (a, x) => {
      const p = personFor(a, x.personId)
      assertVersion(p, x.field, x.versionId)
      return people.updatePerson(a, x.personId, claims.restore(p, x.field, x.versionId))
    },
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${x.field} ← ${x.versionId}` }),
  }),
  choose_version: def({
    risk: 'write',
    description: 'Make one version of a value the main one. Version ids come from get_person (`claims`). A value not yet saved as a version has the id cur:<field>:<value>.',
    input: z.object({ personId: z.string(), field: claimField, versionId: z.string() }),
    refs: { personId: 'persons' },
    apply: (a, x) => {
      const p = personFor(a, x.personId)
      assertVersion(p, x.field, x.versionId)
      return people.updatePerson(a, x.personId, claims.accept(p, x.field, x.versionId))
    },
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${x.field} → ${x.versionId}` }),
  }),
  reject_version: def({
    risk: 'danger',
    description: 'Mark a version as wrong, with the reason. It is kept, so nobody accepts it again. If it was the main one, the next version takes over.',
    input: z.object({ personId: z.string(), field: claimField, versionId: z.string(), reason: z.string().min(1).max(200) }),
    refs: { personId: 'persons' },
    apply: (a, x) => {
      const p = personFor(a, x.personId)
      assertVersion(p, x.field, x.versionId)
      return people.updatePerson(a, x.personId, claims.reject(p, x.field, x.versionId, x.reason))
    },
    describe: (x, c) => ({ text: `${c.name(x.personId)}: ${x.field} ✕ ${x.reason}` }),
  }),
  import_text: def({
    risk: 'danger',
    description: `The way to add several people at once: one confirmation, one undo. Only adds and changes, never deletes. Always goes to review for tokens. One person per line: Name Surname b: 1880, bp: Tula, d: 1950, dp: Oryol, sex: m, maiden: Ivanova. "A + B m: 1905" is a couple, indented lines under it are their children, and a single person's indented lines are theirs. An indented line is always a child: a spouse is never indented, write A + B. A person named again later is the same person. Point at someone already in the archive with id: their id. Example:
Иван Соколов id: abc + Анна Соколова id: def
  Глеб Соколов b: 1950, d: 1995, sex: m
Глеб Соколов + Зоя Тарасова b: 1952, d: 2015, sex: f, m: 1974
  Инна Соколова b: 1975, d: 2020, sex: f
The answer lists each new person's id.`,
    input: z.object({ text: z.string().min(1), resolutions: z.record(z.string(), z.string()).optional().describe('For ambiguous names reported in an error: reference → person id, or "new"') }),
    bulk: true,
    expand: (a, x) => {
      const plan = planFamilyText(parseFamilyText(x.text), people.getGraph(a), x.resolutions)
      if (plan.errors.length || plan.ambiguous.length) throw new OpError(422, JSON.stringify({ errors: plan.errors, ambiguous: plan.ambiguous }))
      if (isAgent(a)) assertPlanSound(a, plan.ops)
      return plan.ops
    },
    apply: () => { throw new OpError(500, 'import_text is expanded before applying') },
    describe: () => ({ text: '' }),
  }),
  import_gedcom: def({
    risk: 'danger',
    description: 'Import a GEDCOM 5.5.1 or 7.0 file as text. Always goes to review for tokens.',
    input: z.object({ text: z.string().min(1), mode: z.enum(['add', 'merge', 'replace']).default('add') }),
    bulk: true,
    apply: (a, x) => importGedcom(a, x.text, x.mode),
    describe: (x) => {
      const n = (x.text.match(/^0 @[^@]+@ INDI/gm) ?? []).length
      return { text: `${say('Импорт GEDCOM')}: ${n} ${say('людей')}` }
    },
  }),
  import_kinship_case: def({
    risk: 'danger',
    description: 'Bring in a research case made by the ex-USSR kinship skill: pass the case_id from its case-intake.yaml and the text of its person-register.csv, relationship-register.csv, claims-register.csv and artifact-register.csv. Candidates stay separate cards, hypotheses stay notes and never become lines on the chart, and everyone not known to be dead counts as living. Importing the same case again adds only what is new, and never replaces what a person wrote. Always goes to review for tokens.',
    input: caseFiles,
    bulk: true,
    apply: (a, x) => importCase(a, x),
    describe: () => ({ text: say('Импорт дела') }),
  }),
  undo: def({
    risk: 'danger',
    description: 'Roll back a change from the history. A token can undo only its own changes.',
    input: z.object({ historyId: z.string() }),
    direct: true,
    apply: (a, x) => undo(a, x.historyId, say('Отменено')),
    describe: () => ({ text: say('Отменено') }),
  }),
}
