// Every tool, run for real against the invented family: what it answers must match its declared type.
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { assistantActor } from '../lib/agent/agent'
import { saveAttachment } from '../lib/agent/attachments'
import { getDb, schema } from '../lib/db'
import type { Actor } from '../lib/ops/core'
import { TOOLS } from '../lib/ops/tools'
import { loadFamily, owner } from './fixture-family'

let f: Awaited<ReturnType<typeof loadFamily>>
beforeAll(async () => { f = await loadFamily() })

const GED = '0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Савва /Гедкомов/\n1 BIRT\n2 DATE 1790\n1 DEAT\n2 DATE 1850\n0 TRLR\n'
const token: Actor = { ...owner, tokenId: 't1', name: 'робот' }

/** In order: later calls use what earlier ones made. A tool missing here fails the test below. */
async function cases(): Promise<[string, (made: Record<string, any>) => unknown, Actor?][]> {
  const a = assistantActor(owner)
  const text = await saveAttachment(a, Buffer.from(GED), 'древо.ged')
  const image = await saveAttachment(a, await sharp({ create: { width: 20, height: 20, channels: 3, background: '#777' } }).png().toBuffer(), 'фото.png')
  const parentLink = () => getDb().select().from(schema.parentChild).all().find((l) => l.parentId === f.nikolai.id)!.id
  const unionLink = () => getDb().select().from(schema.unions).all().find((u) => u.aId === f.nikolai.id)!.id
  return [
    ['get_overview', () => ({})],
    ['find_gaps', () => ({})],
    ['parse_table', () => ({ csv: 'Имя,Фамилия\nЗахар,Таблицын\n' })],
    ['search_people', () => ({ query: 'Соколов' })],
    ['get_person', () => ({ id: f.nikolai.id })],
    ['get_relatives', () => ({ id: f.ivan.id })],
    ['how_related', () => ({ from: f.pyotr.id, to: f.nikolai.id })],
    ['list_pages', () => ({ personId: f.nikolai.id })],
    ['get_page', () => ({ id: f.life.id, raw: true })],
    ['list_photos', () => ({ personId: f.ivan.id })],
    ['list_photos', () => ({})],
    ['export_text', () => ({})],
    ['preview_text', () => ({ text: 'Новый Человек b: 1800, d: 1850' })],
    ['export_gedcom', () => ({})],
    ['preview_gedcom', () => ({ text: GED })],
    ['get_history', () => ({})],
    ['my_proposals', () => ({}), token],
    ['query_people', () => ({ place: 'Тула', groupBy: 'surname' })],
    ['search_archive', () => ({ query: 'кузница' })],
    ['create_person', () => ({ person: { givenName: 'Тест', surname: 'Новый', birthDate: '1925', deathDate: '1950' }, relation: { type: 'son', to: f.maria.id } })],
    ['update_person', () => ({ id: f.varvara.id, patch: { deathPlace: 'Тула' } })],
    ['update_people', () => ({ changes: [{ id: f.varvara.id, patch: { deathPlace: 'Тула 2' } }, { id: f.nikolai.id, patch: { deathPlace: 'Тула 2' } }] })],
    ['add_relation', () => ({ type: 'spouse', to: f.pyotr.id, other: f.varvara.id })],
    ['update_relation', () => ({ type: 'parent', id: parentLink(), kind: 'birth', certainty: 'documented' })],
    ['update_relation', () => ({ type: 'union', id: unionLink(), place: 'Тула', startDate: '1885' })],
    ['create_page', () => ({ personId: f.maria.id, title: 'Заметка', markdown: 'Текст' })],
    ['update_page', (m) => ({ id: m.create_page.id, markdown: 'Другой текст' })],
    ['move_page', (m) => ({ id: m.create_page.id, position: 2 })],
    ['upload_photo', () => ({ base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', filename: 'p.png', personId: f.maria.id })],
    ['update_photo', () => ({ id: f.photo.id, caption: 'Свадьба' })],
    ['tag_photo', () => ({ mediaId: f.photo.id, personId: f.maria.id })],
    ['set_avatar', () => ({ personId: f.ivan.id, mediaId: f.photo.id })],
    ['add_version', () => ({ personId: f.maria.id, field: 'birthPlace', value: 'Ярославль', source: { title: 'Письмо' } })],
    ['add_source', () => ({ personId: f.maria.id, title: 'Книга' })],
    ['remove_source', (m) => ({ personId: f.maria.id, sourceId: m.add_source.sourceId })],
    ['choose_version', () => ({ personId: f.maria.id, field: 'birthPlace', versionId: 'cur:birthPlace:Кострома' })],
    ['reject_version', () => ({ personId: f.maria.id, field: 'birthPlace', versionId: 'cur:birthPlace:Кострома', reason: 'ошибка' })],
    ['restore_version', () => ({ personId: f.maria.id, field: 'birthPlace', versionId: 'cur:birthPlace:Кострома' })],
    ['import_text', () => ({ text: 'Импорт Текстом b: 1800, d: 1850' })],
    ['import_gedcom', () => ({ text: GED })],
    ['import_kinship_case', () => ({ persons: 'person_id,preferred_label\nZ-1,Зоя Тестова\n' })],
    ['get_settings', () => ({})],
    ['update_settings', () => ({ familyName: 'Лесные' })],
    ['list_users', () => ({})],
    ['create_invite', () => ({ name: 'Тётя', role: 'reader' })],
    ['list_invites', () => ({})],
    ['use_tools', () => ({ groups: ['pages'] })],
    ['set_plan', () => ({ steps: [{ text: 'Шаг' }], note: 'заметка' })],
    ['focus_person', () => ({ id: f.ivan.id })],
    ['show_path', () => ({ from: f.pyotr.id, to: f.nikolai.id })],
    ['set_chart_direction', () => ({ rootsBelow: true })],
    ['read_attachment', () => ({ id: text.id })],
    ['save_attachment', () => ({ id: image.id, personId: f.maria.id, caption: 'Открытка' })],
    ['import_gedcom_attachment', () => ({ id: text.id })],
    ['untag_photo', () => ({ id: getDb().select().from(schema.mediaTags).all().find((t) => t.personId === f.maria.id && t.mediaId === f.photo.id)!.id })],
    ['remove_relation', () => ({ type: 'union', id: unionLink() })],
    ['remove_parent_links', () => ({ ids: [getDb().select().from(schema.parentChild).all().find((l) => l.parentId === f.varvara.id)!.id] })],
    ['delete_photo', (m) => ({ id: m.upload_photo.id })],
    ['delete_page', (m) => ({ id: m.create_page.id })],
    ['delete_person', (m) => ({ id: m.create_person.id })],
    ['undo', () => ({ historyId: getDb().select().from(schema.history).all().at(-1)!.id })],
    ['revoke_invite', (m) => ({ id: m.list_invites[0].id })],
  ]
}

describe('tool answers', () => {
  it('every tool answers in its declared type, and none keeps a field it does not declare', async () => {
    const table = await cases()
    expect([...new Set(table.map(([n]) => n))].sort()).toEqual(TOOLS.map((t) => t.name).filter((n) => n !== 'set_user_role').sort())
    const made: Record<string, any> = {}
    const failed: string[] = []
    for (const [name, args, as] of table) {
      const t = TOOLS.find((x) => x.name === name)!
      const actor = as ?? (t.surfaces.includes('assistant') ? assistantActor(owner) : owner)
      try {
        const out = await t.run(actor, t.input.parse(args(made)))
        expect(t.output.safeParse(out).success, name).toBe(true)
        made[name] ??= out
      } catch (e) {
        failed.push(`${name}: ${(e as Error).message}`)
      }
    }
    expect(failed).toEqual([])
  })
})
