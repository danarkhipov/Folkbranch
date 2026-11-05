// A reader cannot change the archive, but can say what is wrong. The correction waits in the same queue as a token's.
import { z } from 'zod'
import { Actor, newId, OpError } from './core'
import { personFor, personInput } from './op-defs'
import * as media from './media'
import { enqueue, pendingOps, pendingVoices } from './proposals'
import { say } from './settings'
import { createStory, newStory } from './stories'

/** A reader's voices wait on the volume until someone looks at them. */
const MAX_PENDING_VOICES = 5
/** Enough for a relative with a lot to say, not enough to bury the person who has to read it. */
const MAX_PENDING = 30

const input = z.object({
  personId: z.string().max(40),
  patch: personInput.pick({ givenName: true, surname: true, maidenName: true, patronymic: true, birthDate: true, birthPlace: true, deathDate: true, deathPlace: true }).partial().default({}),
  text: z.string().trim().max(4000).default(''),
  note: z.string().trim().max(300).default(''),
})

const paragraphs = (text: string) => text.split(/\n\s*\n/).map((p) => ({ id: newId(), type: 'paragraph', props: {}, content: [{ type: 'text', text: p.trim(), styles: {} }], children: [] }))

export function suggest(actor: Actor, raw: unknown) {
  if (actor.role !== 'reader' || actor.tokenId || actor.guest || actor.assistant) throw new OpError(403, 'forbidden')
  const { personId, patch, text, note } = input.parse(raw)
  // Someone hidden from this reader cannot be corrected by them: they do not know who it is.
  const person = personFor(actor, personId) as unknown as Record<string, string>
  const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => (v ?? '').trim() !== (person[k] ?? '')).map(([k, v]) => [k, (v ?? '').trim()]))
  const fields = Object.keys(changed)
  if (!fields.length && !text) throw new OpError(400, say('Нечего предлагать'))
  if (pendingOps(actor) >= MAX_PENDING) throw new OpError(429, say('Слишком много предложений ждут проверки. Подождите, пока их посмотрят.'))
  const from = note ? [`${say('Откуда это известно')}: ${note}`] : []
  return enqueue(actor, [
    // `seen`: the values as they stand now, so an accepted suggestion cannot overwrite what someone wrote in between.
    ...(fields.length ? [{ op: 'update_person', args: { id: personId, patch: changed, seen: Object.fromEntries(fields.map((k) => [k, person[k]])) }, details: from }] : []),
    ...(text ? [{ op: 'create_page', args: { personId, title: `${say('Дополнение')}: ${actor.name}`, content: paragraphs(text) }, details: [text, ...from] }] : []),
  ] as never)
}

/** From the page: an editor's story goes in, a reader's waits. Whatever fails after the file is stored takes the file with it. */
export async function addStory(actor: Actor, raw: unknown, file: { buf: Buffer; name: string } | null) {
  if (actor.tokenId || actor.assistant || actor.guest) throw new OpError(403, 'forbidden')
  const x = newStory.parse(raw)
  // A reader cannot put anyone hidden from them into a story, as its subject or as its teller.
  for (const id of [...x.about, ...(x.tellerId ? [x.tellerId] : [])]) personFor(actor, id)
  if (!x.body && !file) throw new OpError(400, say('Нужна запись голоса или текст'))
  const reader = actor.role === 'reader'
  if (reader && pendingOps(actor) >= MAX_PENDING) throw new OpError(429, say('Слишком много предложений ждут проверки. Подождите, пока их посмотрят.'))
  if (reader && file && pendingVoices(actor) >= MAX_PENDING_VOICES) throw new OpError(429, say('Слишком много записей ждут проверки. Подождите, пока их посмотрят.'))
  const audio = file ? await media.storeAudio(file.buf, file.name || 'voice', actor.userId) : null
  try {
    if (!reader) return createStory(actor, { ...x, audio })
    return enqueue(actor, [{ op: 'create_story', args: { ...x, audio, createdBy: actor.name } }] as never)
  } catch (e) {
    if (audio) await media.discardUpload(audio.id)
    throw e
  }
}
