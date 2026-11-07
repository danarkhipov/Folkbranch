// What each tool answers. An agent gets exactly these fields: anything else a function returns stays
// behind, and an answer of the wrong shape is an error rather than garbage in the conversation.
import { z } from 'zod'

const id = z.string()
const text = z.string()
const ok = z.object({ ok: z.literal(true) })

const brief = z.object({ id, hidden: z.literal(true).optional(), name: text.optional(), years: text.optional(), sex: text.optional(), living: z.boolean().optional(), place: text.optional() })
const fact = z.object({ kind: text, date: text, place: text, note: text, source: text }).partial()
const source = z.object({ id, title: text, ref: text, page: text, url: text, reliability: text }).partial()
const claim = z.object({ id, field: text, value: text, sourceId: id.nullable(), status: text, reason: text, at: z.number() })
const fullPerson = z.object({
  id, givenName: text, surname: text, maidenName: text, patronymic: text, otherNames: text, sex: text,
  birthDate: text, birthPlace: text, deathDate: text, deathPlace: text, living: z.boolean(), certainty: text, avatarMediaId: id.nullable(), updatedAt: z.number(),
  tags: z.array(text), facts: z.array(fact), sources: z.array(source), claims: z.array(claim),
})
/** A write answers with what was written, short: the model already knows the rest. */
const written = z.object({ id, givenName: text, surname: text, birthDate: text, deathDate: text, living: z.boolean() })
const relative = z.object({ name: text.optional() })
const pageMeta = z.object({ id, personId: id, parentPageId: id.nullable(), title: text, icon: text, updatedAt: z.number() })
const photo = z.object({ id, kind: text, originalName: text, caption: text, date: text, place: text, tags: z.array(z.object({ id, personId: id.nullable(), label: text.nullable() })).optional() })
const proposal = z.object({ id, status: text, error: text.nullable(), ops: z.array(z.object({ op: text, text })) })
const applied = z.object({ applied: z.number(), ids: z.record(z.string(), z.string()), people: z.array(z.object({ name: text, id, parents: z.array(text).optional(), spouses: z.array(text).optional() })).optional(), check: z.object({ unlinked: z.array(text) }).optional() })
const importCount = z.object({ persons: z.number() })

/** A token's write can wait for a person instead of running. */
const pending = z.object({ status: z.literal('pending_review'), proposalId: id, tempId: id.optional(), id: id.optional(), tempIds: z.array(id).optional(), message: text })
const write = (shape: z.ZodType) => z.union([pending, shape])

export const OUTPUTS: Record<string, z.ZodType> = {
  get_overview: z.object({
    family: text, you: z.object({ role: text, writes: text }),
    people: z.object({ total: z.number(), hiddenFromYou: z.number(), links: z.number(), unions: z.number() }),
    values: z.object({ documented: z.number(), told: z.number(), unsourced: z.number(), conflicts: z.number() }),
    yourDrafts: z.number(), next: text,
  }),
  find_gaps: z.array(brief.extend({ missing: z.array(text), unsourced: z.number(), conflicts: z.array(text) })),
  parse_table: z.object({ columns: z.record(z.string(), z.string()), text, people: z.number(), warnings: z.array(z.object({ key: text, detail: text.optional() })) }),
  search_people: z.array(brief),
  get_person: z.object({
    person: fullPerson,
    parents: z.array(relative.extend({ linkId: id, personId: id, kind: text, certainty: text })),
    children: z.array(relative.extend({ linkId: id, personId: id, kind: text, certainty: text })),
    unions: z.array(relative.extend({ linkId: id, personId: id, kind: text, startDate: text, endDate: text, place: text })),
    pages: z.array(pageMeta),
  }),
  get_relatives: z.array(brief.extend({ relation: text, blood: z.boolean() })),
  how_related: z.object({ relation: text.nullable(), blood: z.boolean().optional(), path: z.array(z.object({ id, name: text })).optional() }),
  list_pages: z.array(pageMeta),
  get_page: pageMeta.extend({ markdown: text, content: z.array(z.unknown()).optional() }),
  list_photos: z.array(photo),
  export_text: text,
  preview_text: z.object({ creates: z.array(text), updates: z.array(z.unknown()), relations: z.number(), ambiguous: z.array(z.unknown()), errors: z.array(z.unknown()), operations: z.number() }),
  export_gedcom: text,
  preview_gedcom: z.object({ version: text, persons: z.number(), families: z.number(), sample: z.array(text), existing: z.number() }),
  get_history: z.array(z.object({ id, at: z.number(), actorName: text, summary: text, details: z.array(z.object({ label: text, before: text.nullable(), after: text.nullable() })).optional(), personIds: z.array(id), undoOf: id.nullable(), undoneAt: z.number().nullable() })),
  my_proposals: z.array(proposal),
  query_people: z.object({ total: z.number(), people: z.array(brief.extend({ birthPlace: text.optional(), deathPlace: text.optional() })), groups: z.array(z.object({ key: text, count: z.number() })).optional() }),
  search_archive: z.object({ total: z.number(), results: z.array(z.object({ kind: text, id, personId: id.nullish(), title: text, snippet: text })) }),

  create_person: write(written),
  update_person: write(written),
  update_people: write(applied),
  delete_person: write(ok),
  add_relation: write(ok),
  update_relation: write(ok),
  remove_relation: write(ok),
  remove_parent_links: write(ok),
  create_page: write(z.object({ id, title: text })),
  update_page: write(z.object({ updatedAt: z.number() })),
  move_page: write(z.object({ updatedAt: z.number() })),
  delete_page: write(ok),
  upload_photo: write(z.object({ id, kind: text, originalName: text })),
  update_photo: write(ok),
  delete_photo: write(ok),
  tag_photo: write(z.object({ id, mediaId: id, personId: id.nullable(), label: text.nullable() })),
  untag_photo: write(ok),
  set_avatar: write(ok),
  add_version: write(written),
  add_source: write(z.object({ sourceId: id })),
  remove_source: write(ok),
  restore_version: write(written),
  choose_version: write(written),
  reject_version: write(written),
  import_text: write(applied),
  import_gedcom: write(importCount),
  undo: write(ok),

  get_settings: z.object({ familyName: text, language: text }),
  update_settings: ok,
  list_users: z.array(z.object({ id, name: text, role: text })),
  set_user_role: ok,
  list_invites: z.array(z.object({ id, name: text, role: text })),
  create_invite: z.object({ link: text }),
  revoke_invite: ok,
  use_tools: z.object({ loaded: z.array(text) }),
  set_plan: z.object({ steps: z.array(z.object({ text, done: z.boolean() })), note: text.optional() }),
  focus_person: z.object({ id, name: text }),
  show_path: z.object({ path: z.array(id), relation: text }),
  set_chart_direction: z.object({ rootsBelow: z.boolean() }),

  read_attachment: z.object({ text, total: z.number(), more: z.boolean() }),
  save_attachment: z.object({ id, kind: text, name: text }),
  import_gedcom_attachment: importCount,
}
