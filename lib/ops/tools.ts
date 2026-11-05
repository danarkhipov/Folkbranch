// Every tool an agent can use, described once. MCP and the built-in assistant are both built from
// this list, so what one can do and what the ops layer allows never drift apart.
import { z } from 'zod'
import { blocksToMarkdown } from '../markdown'
import { Family } from '../kinship'
import { parseFamilyText, planFamilyText, serializeFamilyText } from '../textformat'
import { summary } from '../claims'
import { guessMapping, parseCsv, rowsToText, type Mapping } from '../import-formats'
import { lifeYears, personName, type Lang, type Person, type Role } from '../types'
import { Actor, can, OpError } from './core'
import { attachmentBytes, findAttachment, readAttachmentText } from '../agent/attachments'
import { exportGedcom, importGedcom, previewGedcom } from './gedcom'
import { listAllMedia, listPersonMedia, updateMedia, uploadMedia } from './media'
import { getPage, listPages } from './pages'
import { findGaps } from './gaps'
import { getGraph } from './people'
import { OUTPUTS } from './outputs'
import { describeOp, dispatch, myProposals } from './proposals'
import { OPS } from './registry'
import { findPeople, queryPeople, queryInput, searchArchive } from './search'
import { createInvite, getSetting, say, listHistory, listInvites, listUsers, revokeInvite, setSetting, setUserRole } from './settings'

/**
 * read and ui run on their own; write asks unless the person allowed it for this conversation;
 * danger and admin always ask. admin is for the owner's settings.
 */
export type Risk = 'read' | 'ui' | 'write' | 'danger' | 'admin'
export type Surface = 'mcp' | 'assistant'
export interface ToolDef {
  name: string
  description: string
  input: z.ZodObject
  risk: Risk
  minRole: Role
  surfaces: Surface[]
  run: (actor: Actor, args: any) => unknown
  /** In words, for the person asked to allow it. */
  describe?: (actor: Actor, args: any) => string
  /** The type of the answer: run returns only these fields, or fails. */
  output: z.ZodType
  /** What the model gets instead of the output, when the output holds a secret only the person may see. */
  forModel?: (output: any) => unknown
}

const lang = (): Lang => (getSetting('language') === 'en' ? 'en' : 'ru')
const brief = (p: Person) => (p.hidden ? { id: p.id, hidden: true } : { id: p.id, name: fullName(p), years: lifeYears(p), sex: p.sex, living: p.living, place: p.birthPlace })
const fullName = (p: Person) => [p.givenName, p.patronymic, p.surname].filter(Boolean).join(' ')

function visiblePerson(actor: Actor, id: string) {
  const g = getGraph(actor)
  const p = g.persons.find((x) => x.id === id)
  if (!p || p.hidden) throw new OpError(404, `person ${id} not found`)
  return { g, p }
}

/** Read tools: what each returns is already limited by the caller's role in the ops layer. */
const READS: Record<string, { description: string; input: z.ZodObject; run: (a: Actor, x: any) => unknown }> = {
  get_overview: {
    description: 'Start here. Who you are in this archive, whether your writes go to review, how many people there are, how much is unsourced or in conflict, and how many of your drafts wait.',
    input: z.object({}),
    run: (a) => {
      const g = getGraph(a)
      const visible = g.persons.filter((p) => !p.hidden)
      const cards = visible.map(summary)
      const count = (key: keyof ReturnType<typeof summary>) => cards.reduce((n, c) => n + c[key], 0)
      return {
        family: getSetting('familyName') ?? '',
        you: { role: a.role, writes: a.role === 'reader' ? 'not allowed' : a.assistant ? 'call the tool: the app asks the person when needed' : a.review ? 'go to review: a person accepts the draft first' : 'apply at once, except imports, which go to review' },
        people: { total: g.persons.length, hiddenFromYou: g.persons.length - visible.length, links: g.parentChild.length, unions: g.unions.length },
        values: { documented: count('documented'), told: count('told'), unsourced: count('unsourced'), conflicts: count('conflict') },
        yourDrafts: a.tokenId ? myProposals(a).filter((d) => d.status === 'pending').length : 0,
        next: a.role === 'reader' ? 'Read with search_people, get_person, how_related.' : 'Call find_gaps, research one person, record results with add_version.',
      }
    },
  },
  find_gaps: {
    description: 'What is unfinished, person by person: missing dates and places, no parents, values without a source, conflicting versions. People with conflicts come first. Good as a work queue.',
    input: z.object({ limit: z.number().int().min(1).max(200).default(30), onlyConflicts: z.boolean().default(false) }),
    run: (a, x) => findGaps(a, x).map(({ person, ...r }) => ({ ...brief(person), ...r })),
  },
  parse_table: {
    description: 'Turn a CSV table into the text format, ready for preview_text and import_text. Columns are guessed from the headers (Russian or English: name, surname, born, died, father, mother, spouse...). Pass `columns` to override, one field per column: id, name, given, patronymic, surname, maiden, sex, birthDate, birthPlace, deathDate, deathPlace, father, mother, spouse, or empty to skip.',
    input: z.object({ csv: z.string().min(1), columns: z.array(z.string()).optional() }),
    run: (_a, x) => {
      const rows = parseCsv(x.csv)
      if (rows.length < 2) throw new OpError(400, 'the table has no rows with people')
      const mapping = (x.columns ?? guessMapping(rows[0])) as Mapping
      if (!mapping.some((m) => m === 'name' || m === 'given' || m === 'surname')) throw new OpError(400, `no name column among: ${rows[0].join(', ')}. Pass columns.`)
      return { columns: Object.fromEntries(rows[0].map((h, i) => [h, mapping[i] ?? ''])), ...rowsToText(rows.slice(1), mapping, getSetting('familyName') ?? '') }
    },
  },
  search_people: {
    description: 'Find people by parts of a name in any order, patronymic, maiden or other name, place, group or fact. Forgives typos. Empty query lists people up to the limit: get_overview gives the total. Use before creating anyone.',
    input: z.object({ query: z.string().default(''), limit: z.number().int().min(1).max(500).default(20) }),
    run: (a, x) => findPeople(a, x.query, x.limit).map(brief),
  },
  get_person: {
    description: 'All fields of a person, their parents, children and spouses by name with link ids, and their pages.',
    input: z.object({ id: z.string() }),
    run: (a, x) => {
      const { g, p } = visiblePerson(a, x.id)
      const named = (personId: string) => {
        const other = g.persons.find((q) => q.id === personId)
        return { personId, ...(other && !other.hidden ? { name: fullName(other) } : {}) }
      }
      return {
        person: p,
        parents: g.parentChild.filter((l) => l.childId === x.id).map((l) => ({ ...l, linkId: l.id, ...named(l.parentId) })),
        children: g.parentChild.filter((l) => l.parentId === x.id).map((l) => ({ ...l, linkId: l.id, ...named(l.childId) })),
        unions: g.unions.filter((u) => u.aId === x.id || u.bId === x.id).map((u) => ({ ...u, linkId: u.id, ...named(u.aId === x.id ? u.bId : u.aId) })),
        pages: listPages(a, x.id),
      }
    },
  },
  get_relatives: {
    description: 'Everyone related to a person, with the kinship term for each.',
    input: z.object({ id: z.string() }),
    run: (a, x) => {
      const { g } = visiblePerson(a, x.id)
      const byId = new Map(g.persons.map((p) => [p.id, p]))
      return [...new Family(g).relatives(x.id, lang())].map(([id, k]) => ({ ...brief(byId.get(id)!), relation: k.label, blood: k.blood }))
    },
  },
  how_related: {
    description: 'How `to` is related to `from`: a kinship term and the path between them.',
    input: z.object({ from: z.string(), to: z.string() }),
    run: (a, x) => {
      const { g } = visiblePerson(a, x.from)
      visiblePerson(a, x.to)
      const k = new Family(g).relation(x.from, x.to, lang())
      const name = (id: string) => { const p = g.persons.find((q) => q.id === id)!; return p.hidden ? 'hidden' : personName(p) }
      return k ? { relation: k.label, blood: k.blood, path: k.path.map((id) => ({ id, name: name(id) })) } : { relation: null }
    },
  },
  list_pages: {
    description: 'The pages about a person, without their text.',
    input: z.object({ personId: z.string() }),
    run: (a, x) => listPages(a, x.personId),
  },
  get_page: {
    description: 'A page as Markdown. Set raw to also get the BlockNote JSON.',
    input: z.object({ id: z.string(), raw: z.boolean().default(false) }),
    run: (a, x) => {
      const { content, ...meta } = getPage(a, x.id)
      const blocks = JSON.parse(content)
      return { ...meta, markdown: blocksToMarkdown(blocks), ...(x.raw ? { content: blocks } : {}) }
    },
  },
  list_photos: {
    description: "Photos with their tags: of one person, or all of them. Fetch a file from /api/v1/media/ID/file with the same token.",
    input: z.object({ personId: z.string().optional() }),
    run: (a, x) => (x.personId ? listPersonMedia(a, x.personId) : listAllMedia(a)),
  },
  export_text: {
    description: 'The whole graph in the text format: `family Title`, `Name id: x, b: 1880, d: 1950, sex: m`, `A + B m: 1905` with children indented below. Edit it and send it back with import_text.',
    input: z.object({}),
    run: (a) => serializeFamilyText(getGraph(a), getSetting('familyName') ?? ''),
  },
  preview_text: {
    description: 'What import_text would do with this text, without changing anything.',
    input: z.object({ text: z.string(), resolutions: z.record(z.string(), z.string()).optional() }),
    run: (a, x) => {
      const { ops, ...plan } = planFamilyText(parseFamilyText(x.text), getGraph(a), x.resolutions)
      return { ...plan, operations: ops.length }
    },
  },
  export_gedcom: {
    description: 'The graph as GEDCOM 5.5.1 text.',
    input: z.object({ hideLiving: z.boolean().default(true).describe('False keeps living people in the file') }),
    run: (a, x) => exportGedcom(a, x.hideLiving),
  },
  preview_gedcom: {
    description: 'Counts what a GEDCOM file holds, without importing it.',
    input: z.object({ text: z.string() }),
    run: (a, x) => previewGedcom(a, x.text),
  },
  get_history: {
    description: 'Recent changes, newest first, with ids for undo.',
    input: z.object({ limit: z.number().int().min(1).max(200).default(15) }),
    run: (a, x) => listHistory(a, x.limit),
  },
  my_proposals: {
    description: "This token's recent drafts and whether a person accepted them.",
    input: z.object({}),
    run: (a) => myProposals(a),
  },
}

/** Every request carries what its tools look like, so only these go along until the model asks for more. */
export const CORE_TOOLS = ['search_people', 'query_people', 'search_archive', 'get_person', 'how_related', 'create_person', 'update_person', 'delete_person', 'add_relation', 'remove_relation', 'import_text', 'add_source', 'undo', 'get_history', 'set_plan', 'use_tools']
export const TOOL_GROUPS: Record<string, { about: string; tools: string[] }> = {
  people: { about: 'many at once, relatives, gaps, overview, link details, whole tree, tables', tools: ['update_people', 'get_relatives', 'find_gaps', 'get_overview', 'update_relation', 'remove_parent_links', 'export_text', 'preview_text', 'parse_table'] },
  sources: { about: 'removing sources, versions of values', tools: ['remove_source', 'add_version', 'choose_version', 'reject_version', 'restore_version'] },
  files: { about: 'photos, avatars, attached files, GEDCOM', tools: ['list_photos', 'save_attachment', 'set_avatar', 'tag_photo', 'untag_photo', 'update_photo', 'delete_photo', 'upload_photo', 'read_attachment', 'import_gedcom_attachment', 'export_gedcom', 'preview_gedcom', 'import_gedcom'] },
  pages: { about: 'pages about people', tools: ['list_pages', 'get_page', 'create_page', 'update_page', 'move_page', 'delete_page'] },
  screen: { about: 'show someone or a path on the chart', tools: ['focus_person', 'show_path', 'set_chart_direction'] },
  admin: { about: 'archive name, language, people with access, invitations', tools: ['get_settings', 'update_settings', 'list_users', 'set_user_role', 'list_invites', 'create_invite', 'revoke_invite'] },
}

const toModelSafeInvite = () => ({ created: true, note: 'The link is shown to the person in the chat. You do not have it.' })
const roleInput = z.enum(['owner', 'editor', 'reader'])

/** Settings and what is on screen exist only for the assistant: tokens are refused these on purpose. */
const ASSISTANT_ONLY: Omit<ToolDef, 'output'>[] = [
  { name: 'get_settings', risk: 'read', minRole: 'reader', surfaces: ['assistant'], description: "The archive's name and language.", input: z.object({}),
    run: () => ({ familyName: getSetting('familyName') ?? '', language: getSetting('language') ?? 'ru' }) },
  { name: 'update_settings', risk: 'admin', minRole: 'owner', surfaces: ['assistant'], description: "Rename the archive or change its language.", input: z.object({ familyName: z.string().min(1).max(120).optional(), language: z.enum(['ru', 'en']).optional() }),
    describe: (_a, x) => [x.familyName && `${say('Название')}: ${x.familyName}`, x.language && `${say('Язык')}: ${x.language}`].filter(Boolean).join(', '),
    run: (_a, x) => {
      Object.entries(x).forEach(([k, v]) => setSetting(k, v as string))
      return { ok: true }
    } },
  { name: 'list_users', risk: 'read', minRole: 'owner', surfaces: ['assistant'], description: 'Who has access and with what role.', input: z.object({}), run: (a) => listUsers(a) },
  { name: 'set_user_role', risk: 'admin', minRole: 'owner', surfaces: ['assistant'], description: "Change someone's role. Not your own person's.", input: z.object({ id: z.string(), role: roleInput }),
    describe: (a, x) => `${listUsers(a).find((u) => u.id === x.id)?.name ?? x.id}: ${x.role}`,
    run: (a, x) => {
      if (!listUsers(a).some((u) => u.id === x.id)) throw new OpError(404, 'no such user')
      setUserRole(a, x.id, x.role)
      return { ok: true }
    } },
  { name: 'list_invites', risk: 'read', minRole: 'owner', surfaces: ['assistant'], description: 'Invitations still open.', input: z.object({}), run: (a) => listInvites(a) },
  { name: 'create_invite', risk: 'admin', minRole: 'owner', surfaces: ['assistant'], description: 'Invite someone. The person sees the link in the chat; you never get it.', input: z.object({ name: z.string().min(1).max(120), role: roleInput.exclude(['owner']), personId: z.string().nullish() }),
    describe: (_a, x) => `${x.name}: ${x.role}`,
    run: (a, x) => ({ link: `/invite/${createInvite(a, x).token}` }), forModel: toModelSafeInvite },
  { name: 'revoke_invite', risk: 'admin', minRole: 'owner', surfaces: ['assistant'], description: 'Cancel an open invitation.', input: z.object({ id: z.string() }),
    describe: (a, x) => listInvites(a).find((i) => i.id === x.id)?.name ?? x.id,
    run: (a, x) => {
      revokeInvite(a, x.id)
      return { ok: true }
    } },
  { name: 'use_tools', risk: 'ui', minRole: 'reader', surfaces: ['assistant'], description: `Load more tools for the next steps: ${Object.entries(TOOL_GROUPS).map(([g, v]) => `${g} (${v.about})`).join('; ')}.`, input: z.object({ groups: z.array(z.enum(Object.keys(TOOL_GROUPS) as [string, ...string[]])).min(1) }),
    run: (_a, x) => ({ loaded: x.groups }) },
  { name: 'set_plan', risk: 'ui', minRole: 'reader', surfaces: ['assistant'], description: 'Show the person your plan as a checklist and keep it for yourself. Call it first for a task of more than two steps, and again with done marks as you go. `note` keeps what later steps need, such as ids.',
    input: z.object({ steps: z.array(z.object({ text: z.string().min(1).max(200), done: z.boolean().default(false) })).min(1).max(20), note: z.string().max(2000).optional() }),
    run: (_a, x) => x },
  { name: 'focus_person', risk: 'ui', minRole: 'reader', surfaces: ['assistant'], description: 'Open a person on the chart for the one you are talking to.', input: z.object({ id: z.string() }),
    run: (a, x) => {
      const { p } = visiblePerson(a, x.id)
      return { id: p.id, name: fullName(p) }
    } },
  { name: 'show_path', risk: 'ui', minRole: 'reader', surfaces: ['assistant'], description: 'Light up on the chart how two people are connected.', input: z.object({ from: z.string(), to: z.string() }),
    run: (a, x) => {
      const { g } = visiblePerson(a, x.from)
      visiblePerson(a, x.to)
      const k = new Family(g).relation(x.from, x.to, lang())
      if (!k) throw new OpError(404, 'these two are not connected')
      return { path: k.path, relation: k.label }
    } },
  { name: 'set_chart_direction', risk: 'ui', minRole: 'reader', surfaces: ['assistant'], description: 'Draw the chart with elders at the bottom (rootsBelow true) or at the top. Applies to this browser only.', input: z.object({ rootsBelow: z.boolean() }),
    run: (_a, x) => ({ rootsBelow: x.rootsBelow }) },
]

/** Files given to the assistant in the conversation. They belong to the person talking to it. */
const ATTACHMENT_TOOLS: Omit<ToolDef, 'output'>[] = [
  { name: 'read_attachment', risk: 'read', minRole: 'reader', surfaces: ['assistant'], description: 'More of a long text file the person attached.', input: z.object({ id: z.string(), offset: z.number().int().min(0).default(0) }),
    run: async (a, x) => readAttachmentText(a, (await findAttachment(a, x.id)).id, x.offset) },
  { name: 'save_attachment', risk: 'write', minRole: 'editor', surfaces: ['assistant'], description: "Keep a file the person attached in the archive, as a photo or document, optionally on a person's card. The result has an id for set_avatar, tag_photo or a page.",
    input: z.object({ id: z.string(), personId: z.string().nullish(), caption: z.string().max(500).optional(), date: z.string().max(60).optional(), place: z.string().max(120).optional() }),
    describe: (a, x) => [x.caption, x.personId && personNameOf(a, x.personId)].filter(Boolean).join(', '),
    run: async (a, x) => {
      if (x.personId) visiblePerson(a, x.personId)
      const att = await findAttachment(a, x.id)
      const m = await uploadMedia(a, await attachmentBytes(a, att.id), att.name, x.personId)
      if (x.caption || x.date || x.place) updateMedia(a, m.id, { caption: x.caption, date: x.date, place: x.place })
      return { id: m.id, kind: m.kind, name: m.originalName }
    } },
  { name: 'import_gedcom_attachment', risk: 'danger', minRole: 'editor', surfaces: ['assistant'], description: 'Add everyone from a GEDCOM file the person attached. Look at it first with its text in the conversation.', input: z.object({ id: z.string() }),
    run: async (a, x) => importGedcom(a, await fullText(a, (await findAttachment(a, x.id)).id)) },
]

async function fullText(a: Actor, id: string) {
  let text = '', offset = 0
  for (;;) {
    const page = await readAttachmentText(a, id, offset)
    text += page.text
    if (!page.more) return text
    offset += page.text.length
  }
}

const personNameOf = (a: Actor, id: string) => { const p = getGraph(a).persons.find((x) => x.id === id); return p && !p.hidden ? fullName(p) : '' }

/** About a token's own drafts, so it means nothing to the assistant. */
const NOT_FOR_ASSISTANT = new Set(['my_proposals'])
const surfaces = (name: string): Surface[] => (NOT_FOR_ASSISTANT.has(name) ? ['mcp'] : ['mcp', 'assistant'])

/**
 * Every answer passes through its type, for MCP and the assistant alike. A surprise is logged and
 * the answer still goes out: a write has already happened, and an error would make a model repeat it.
 */
function typed(t: Omit<ToolDef, 'output'>): ToolDef {
  const output = OUTPUTS[t.name]
  if (!output) throw new Error(`tool ${t.name} has no output type`)
  return {
    ...t,
    output,
    run: async (actor, args) => {
      const raw = (await t.run(actor, args)) ?? { ok: true }
      const answer = output.safeParse(raw)
      if (answer.success) return answer.data
      console.error(`tool ${t.name} answered outside its type`, answer.error.issues)
      return raw
    },
  }
}

type Untyped = Omit<ToolDef, 'output'>
export const TOOLS: ToolDef[] = ([
  ...Object.entries(READS).map(([name, r]): Untyped => ({ name, ...r, risk: 'read', minRole: 'reader', surfaces: surfaces(name) })),
  { name: 'query_people', risk: 'read', minRole: 'reader', surfaces: surfaces('query_people'), input: queryInput,
    description: 'People by exact conditions, with a total and optional counts: birth and death years, place, sex, group, sources, whether they have parents. Use for lists, counts and questions like "who was born in Tula before 1900".',
    run: (a, x) => queryPeople(a, x) },
  { name: 'search_archive', risk: 'read', minRole: 'reader', surfaces: surfaces('search_archive'), input: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(50).default(20) }),
    description: 'Search everything written: people, facts, sources, page text and photo captions. Forgives typos and word endings. Use when you do not know where something is written.',
    run: (a, x) => searchArchive(a, x.query, x.limit) },
  ...Object.entries(OPS).map(([name, d]): Untyped => ({ name, description: d.description, input: (d.agentInput ?? d.input) as z.ZodObject, risk: d.risk, minRole: 'editor', surfaces: surfaces(name), run: (a, x) => dispatch(a, name, x), describe: (a, x) => describeOp(a, name, x) })),
  ...ASSISTANT_ONLY,
  ...ATTACHMENT_TOOLS,
] as Untyped[]).map(typed)

export const toolsFor = (actor: Actor, surface: Surface) => TOOLS.filter((t) => t.surfaces.includes(surface) && can(actor, t.minRole))
