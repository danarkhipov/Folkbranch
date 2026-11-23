import { createAgentUIStreamResponse, validateUIMessages, type LanguageModel, type UIMessage } from 'ai'
import { z } from 'zod'
import type { Actor } from '../ops/core'
import { assistantActor, assistantTools, buildAgent, ToolRefusal } from './agent'
import { modelSees, providerFailure, providerFor, replaceMissingModel } from './provider-key'
import { OpError } from '../ops/core'
import { tell } from '../ops/settings'
import { stampMaker } from './stamp'
import { attachmentBytes, attachmentIdFromUrl, attachmentView, getAttachment, readAttachmentText } from './attachments'
import { demoOn, rememberApprovals, spendApprovals, takeDemoAiMessage } from '../demo-mode'

export const chatInput = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).min(1).max(400),
  trustWrites: z.boolean().default(false),
  focusId: z.string().nullish(),
  /** One answer from another service or model of the owner's list; anything not on it is refused. */
  choice: z.object({ provider: z.string().max(40), model: z.string().max(160) }).nullish(),
})

/**
 * A file part arrives pointing at the person's own attachment and leaves as what the model can
 * read. Anything else is dropped, so a request cannot make the provider fetch an address.
 */
async function withAttachments(person: Actor, messages: UIMessage[], sees: boolean | null): Promise<UIMessage[]> {
  // A file costs tokens on every request, so only the last two questions carry theirs in full.
  const recent = new Set(messages.filter((m) => m.role === 'user').slice(-2))
  return Promise.all(messages.map(async (m) => {
    if (m.role !== 'user' || !m.parts.some((p) => p.type === 'file')) return m
    const parts = await Promise.all(m.parts.map(async (p): Promise<UIMessage['parts']> => {
      if (p.type !== 'file') return [p]
      const id = attachmentIdFromUrl(p.url)
      const att = id ? await getAttachment(person, id).catch(() => null) : null
      if (!id || !att) return [{ type: 'text', text: '[This attachment is no longer available.]' }]
      const label = `Attachment id ${att.id}, named ${JSON.stringify(att.name)}, ${att.kind}, ${att.size} bytes.`
      if (!recent.has(m)) return [{ type: 'text', text: `${label} Attached earlier and no longer shown.${att.kind === 'text' ? ' read_attachment gets its text.' : ''}` }]
      if (sees === false && (att.kind === 'image' || att.kind === 'pdf')) return [{ type: 'text', text: `${label} The model answering cannot see pictures or scans, so this was not shown to it.` }]
      if (att.kind === 'image') return [{ type: 'text', text: label }, { type: 'file', mediaType: 'image/jpeg', filename: att.name, url: `data:image/jpeg;base64,${(await attachmentView(person, id)).toString('base64')}` }]
      if (att.kind === 'pdf') return [{ type: 'text', text: label }, { type: 'file', mediaType: 'application/pdf', filename: att.name, url: `data:application/pdf;base64,${(await attachmentBytes(person, id)).toString('base64')}` }]
      if (att.kind === 'text') {
        const page = await readAttachmentText(person, id)
        return [{ type: 'text', text: `${label} ${page.more ? `Showing the first ${page.text.length} of ${page.total} characters; read_attachment gets the rest.` : ''}\n<attachment>\n${page.text.replace(/<\/?attachment>/gi, '')}\n</attachment>` }]
      }
      return [{ type: 'text', text: `${label} You cannot read this kind of file, but it can be saved to the archive.` }]
    }))
    return { ...m, parts: parts.flat() }
  }))
}

/** When the assistant last spoke: what it read then is what it knows. A first question has read nothing yet. */
const lastAnswerAt = (messages: UIMessage[]) => {
  const at = (messages.findLast((m) => m.role === 'assistant')?.metadata as { at?: unknown } | undefined)?.at
  return typeof at === 'number' ? at : Date.now()
}

/** One turn of the conversation, streamed. Tools come from the actor here, never from the request. */
export async function assistantResponse(person: Actor, body: unknown, opts: { model?: LanguageModel; abortSignal?: AbortSignal } = {}) {
  const input = chatInput.parse(body)
  if (demoOn() && input.messages.length > 40) throw new OpError(413, 'The demo keeps conversations short: start a new one.')
  const messages = await validateUIMessages<UIMessage>({ messages: input.messages, tools: assistantTools(assistantActor(person)) as never })
  // Only the owner sends the archive to another of their services: a key added for speech is not a consent for chat.
  if (input.choice && person.role !== 'owner') throw new OpError(403, tell('Only the owner picks another model for an answer'))
  const picked = input.choice && !opts.model ? providerFor(input.choice.provider, input.choice.model) : null
  if (input.choice && !opts.model && !picked) throw new OpError(400, tell('This model is no longer available. Choose another under “Who answers”'))
  if (!opts.model && !picked) await replaceMissingModel()
  const sees = opts.model ? null : await modelSees(picked ?? undefined)
  const uiMessages = await withAttachments(person, messages.filter((m) => m.role !== 'system'), sees)
  // Every request that is about to call the model counts against the demo copy's share, whatever its last message says:
  // the history is the visitor's own, so a trailing message of any role could be made up. Only an answer to an approval
  // this copy itself asked for (a single-use id it remembers) is free, and a request refused above counted nothing.
  if (demoOn() && !spendApprovals(messages.at(-1))) {
    const over = takeDemoAiMessage()
    if (over) throw new OpError(429, over)
  }
  const res = await createAgentUIStreamResponse({
    agent: buildAgent(person, { sees, model: opts.model, provider: picked, trustWrites: input.trustWrites, focusId: input.focusId, since: lastAnswerAt(messages), hasFiles: messages.some((m) => m.parts.some((p) => p.type === 'file')) }),
    // Instructions come from the server alone.
    uiMessages,
    abortSignal: opts.abortSignal,
    onError: (e) => (e instanceof ToolRefusal ? e.message : (e as { cause?: unknown })?.cause instanceof ToolRefusal ? ((e as { cause: Error }).cause.message) : providerFailure(e) ?? 'The assistant could not answer. Try again.'),
    // What the answer cost, for the check script and anyone who wants to watch it.
    // When it began, and at the end how long it took, in how many steps and tokens (see stamp.ts).
    messageMetadata: ((stamp) => ({ part }: { part: Parameters<typeof stamp>[0] }) => stamp(part))(stampMaker()),
  })
  return demoOn() && res.body ? new Response(res.body.pipeThrough(rememberApprovals()), res) : res
}
