import { createAgentUIStreamResponse, validateUIMessages, type LanguageModel, type UIMessage } from 'ai'
import { z } from 'zod'
import type { Actor } from '../ops/core'
import { assistantActor, assistantTools, buildAgent, ToolRefusal } from './agent'
import { countTokens } from './limits'
import { providerFailure } from './provider-key'
import { attachmentBytes, attachmentIdFromUrl, attachmentView, getAttachment, readAttachmentText } from './attachments'

export const chatInput = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).min(1).max(400),
  trustWrites: z.boolean().default(false),
  focusId: z.string().nullish(),
})

/**
 * A file part arrives pointing at the person's own attachment and leaves as what the model can
 * read. Anything else is dropped, so a request cannot make the provider fetch an address.
 */
async function withAttachments(person: Actor, messages: UIMessage[]): Promise<UIMessage[]> {
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

/** One turn of the conversation, streamed. Tools come from the actor here, never from the request. */
export async function assistantResponse(person: Actor, body: unknown, opts: { model?: LanguageModel; abortSignal?: AbortSignal } = {}) {
  const input = chatInput.parse(body)
  const messages = await validateUIMessages<UIMessage>({ messages: input.messages, tools: assistantTools(assistantActor(person)) as never })
  return createAgentUIStreamResponse({
    agent: buildAgent(person, { model: opts.model, trustWrites: input.trustWrites, focusId: input.focusId, hasFiles: messages.some((m) => m.parts.some((p) => p.type === 'file')) }),
    // Instructions come from the server alone.
    uiMessages: await withAttachments(person, messages.filter((m) => m.role !== 'system')),
    abortSignal: opts.abortSignal,
    onError: (e) => (e instanceof ToolRefusal ? e.message : (e as { cause?: unknown })?.cause instanceof ToolRefusal ? ((e as { cause: Error }).cause.message) : providerFailure(e) ?? 'The assistant could not answer. Try again.'),
    // What the answer cost, for the check script and anyone who wants to watch it.
    messageMetadata: ({ part }) => {
      if (part.type !== 'finish') return undefined
      countTokens(part.totalUsage.totalTokens ?? 0)
      return { usage: part.totalUsage }
    },
  })
}
