'use client'
import { useEffect, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Select } from '@/components/ui/select'
import { DefaultChatTransport, getToolName, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses, type ToolUIPart, type UIMessage } from 'ai'
import { ArrowUp, Check, ChevronDown, Circle, CircleCheck, CircleX, Copy, FileText, History, Loader2, Paperclip, Plus, Undo2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationRequest } from '@/components/ai-elements/confirmation'
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { DictateButton } from './dictate-button'
import { PromptInput, PromptInputBody, PromptInputButton, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools, usePromptInputAttachments, type PromptInputMessage } from '@/components/ai-elements/prompt-input'
import { PanelEdge } from './panel-size'
import { changesData, isOrdinaryEdit, stepLabel, toolLabel } from '@/lib/agent/labels'
import { api, undoFailure, useApp } from '@/lib/client'
import { stepDetail } from '@/lib/agent/labels'
import { subjectOf } from '@/lib/agent/subject'
import { personName } from '@/lib/types'
import { avatarUrl } from '@/lib/client'
import { stampDetail, stampLine, stampOf } from '@/lib/agent/stamp'
import { forgetChat, loadChats, saveChat, type SavedChat } from '@/lib/chat-store'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Scope } from '@/lib/graph/select'

/** Told to the model after a person takes an answer back, so it does not build on what is gone. */
const TAKEN_BACK = '[The edits from this answer were undone]'

/** The server's words when it has them; never a raw response. */
function plainError(e: Error, t: (k: string) => string) {
  try { const said = JSON.parse(e.message); if (said?.plain && typeof said.error === 'string') return said.error } catch {}
  if (!e.message || e.message.startsWith('{') || e.message === 'The assistant could not answer. Try again.') return t('The assistant could not answer.')
  return e.message
}

/** A long step's progress report, before its answer: the step is still running. */
const preliminary = (p: UIMessage['parts'][number]) => !!(p as { preliminary?: boolean }).preliminary
const historyIds = (m: UIMessage) => [...new Set(m.parts.flatMap((p) => (isToolUIPart(p) && p.state === 'output-available' && (p.output as { historyId?: string } | null)?.historyId ? [(p.output as { historyId: string }).historyId] : [])))]

export default function AssistantPanel({ open, width, onWidth, onClose, onPath, onDirection, onBranch }: { open: boolean; width: number; onWidth: (w: number) => void; onClose: () => void; onPath: (path: string[]) => void; onDirection: (rootsBelow: boolean) => void; onBranch: (id: string, scope: Scope) => void }) {
  const { t, focusId, focus, notify, me } = useApp()
  const qc = useQueryClient()
  const router = useRouter()
  const trust = useRef(false)
  const [trusted, setTrusted] = useState(false)
  const focused = useRef(focusId)
  focused.current = focusId
  // Which of the owner's services and models answers: empty is the owner's default.
  const [pick, setPick] = useState(() => (me.role === 'owner' ? readPick(me.id) : null))
  const picked = useRef(pick)
  useEffect(() => { picked.current = pick }, [pick])
  const [transport] = useState(() => new DefaultChatTransport({ api: '/api/agent', body: () => ({ trustWrites: trust.current, focusId: focused.current, ...(picked.current ? { choice: picked.current } : {}) }) }))
  // The conversation survives a reload: the last one opens again, and earlier ones are under History.
  const [last] = useState(() => loadChats(me.id)[0] ?? null)
  const [chatId, setChatId] = useState(() => last?.id ?? crypto.randomUUID())
  const { messages, sendMessage, status, stop, error, regenerate, addToolApprovalResponse, setMessages, clearError } = useChat({ transport, messages: last?.messages ?? [], sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses })
  const busy = status === 'submitted' || status === 'streaming'
  // In the public demo the copy has a few messages to spend: say how many are left. The banner is how a screen knows it is the demo.
  const [demo] = useState(() => !!document.querySelector('[data-demo-banner]'))
  const { data: left, refetch: recount } = useQuery({ queryKey: ['demo-ai'], queryFn: () => api<{ left: number }>('demo/ai'), enabled: demo, retry: false })
  useEffect(() => { if (demo && (status === 'ready' || status === 'error')) recount() }, [demo, status, recount])
  // The copy has no messages left: the box says so instead of offering a retry that cannot work.
  const capped = demo && left?.left === 0
  const capText = error ? plainError(error, t) : t('Assistant messages left in this demo: {count}').replace('{count}', () => '0')
  const pending = messages.at(-1)?.parts.filter((p): p is ToolUIPart => isToolUIPart(p) && p.state === 'approval-requested') ?? []

  // What a finished tool means for the screen behind the chat. What a reopened conversation did to the screen
  // (opening a person, showing a branch) is not done again.
  const seen = (list: UIMessage[]) => new Set(list.flatMap((m) => m.parts.flatMap((p) => (isToolUIPart(p) ? [p.toolCallId] : []))))
  const applied = useRef<Set<string>>(null as never)
  applied.current ??= seen(last?.messages ?? [])
  const openChat = (c: SavedChat) => {
    for (const id of seen(c.messages)) applied.current.add(id)
    setChatId(c.id)
    setMessages(c.messages)
  }
  useEffect(() => { if (!busy) saveChat(me.id, chatId, messages) }, [messages, busy, chatId, me.id])
  useEffect(() => {
    for (const m of messages) {
      for (const p of m.parts) {
        if (!isToolUIPart(p) || p.state !== 'output-available' || applied.current.has(p.toolCallId)) continue
        applied.current.add(p.toolCallId)
        const name = getToolName(p)
        const out = p.output as Record<string, any>
        if (changesData(name)) qc.invalidateQueries()
        if (name === 'update_settings') router.refresh()
        if (name === 'focus_person') focus(out.id)
        if (name === 'show_branch') onBranch(out.id, out.scope)
        if (name === 'show_path') onPath(out.path)
        if (name === 'set_chart_direction') onDirection(out.rootsBelow)
      }
    }
  }, [messages]) // eslint-disable-line react-hooks/exhaustive-deps

  const allowEdits = () => {
    trust.current = true
    setTrusted(true)
    for (const p of pending) if (isOrdinaryEdit(getToolName(p))) addToolApprovalResponse({ id: p.approval!.id, approved: true })
  }
  const forgetEdits = () => {
    trust.current = false
    setTrusted(false)
  }
  const restart = () => {
    stop()
    setChatId(crypto.randomUUID())
    setMessages([])
    clearError()
    forgetEdits()
  }
  /** Files go to the server first, so a conversation carries only their addresses. */
  const submit = async ({ text, files }: PromptInputMessage) => {
    if (!text.trim() && !files.length) return
    try {
      const uploaded = await Promise.all(files.map(async (f) => {
        const form = new FormData()
        form.set('file', await (await fetch(f.url)).blob(), f.filename ?? 'file')
        const res = await fetch('/api/agent/files', { method: 'POST', body: form })
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText)
        const att = await res.json()
        return { type: 'file' as const, mediaType: f.mediaType ?? 'application/octet-stream', filename: att.name as string, url: att.url as string }
      }))
      await sendMessage({ text: text.trim() || t('Have a look at this file'), files: uploaded })
    } catch (e) {
      notify(`${t('Could not upload the file')}: ${(e as Error).message}`)
      throw e
    }
  }
  const [undone, setUndone] = useState<string[]>([])
  const takeBack = async (m: UIMessage) => {
    try {
      for (const id of historyIds(m).reverse()) await api(`history/${id}/undo`, { json: {} })
      setUndone((u) => [...u, m.id])
      setMessages((list) => [...list, { id: `taken-${m.id}`, role: 'user', parts: [{ type: 'text', text: TAKEN_BACK }] }])
      notify(t('Undone'))
    } catch (e) {
      notify(undoFailure(e, t))
    }
    await qc.invalidateQueries()
  }

  return (
    <aside hidden={!open} aria-label={t('Assistant')} style={{ width: `min(${width}px, calc(100vw - 24px))` }} className="assistant side-sheet float fixed left-3 top-[60px] bottom-3 z-10 flex flex-col !bg-[#fffdf8] text-sm [&[hidden]]:hidden">
      <PanelEdge width={width} onWidth={onWidth} />
      <header className="flex items-center gap-1 border-b border-border py-1 pl-3 pr-1">
        <h2 className="flex-1 font-serif text-lg font-medium">{t('Assistant')}</h2>
        <ChatHistory userId={me.id} current={chatId} onOpen={(c) => { stop(); clearError(); forgetEdits(); openChat(c) }} onForget={(c) => { forgetChat(me.id, c.id); if (c.id === chatId) restart() }} />
        {messages.length > 0 && <button className="bar-btn" onClick={restart}><Plus size={15} /> {t('New conversation')}</button>}
        <button className="bar-btn" title={t('Close')} aria-label={t('Close')} onClick={onClose}><X size={15} /></button>
      </header>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="gap-3 p-3">
          {messages.map((m) => {
            if (m.role === 'user' && m.id.startsWith('taken-')) return <p key={m.id} className="text-center text-xs text-ink-soft">{t('This answer\'s changes were undone')}</p>
            // An answer with nothing to show yet (the stream has opened, no text or step has come) takes no room:
            // an empty one would push the "Thinking" line down and the answer back up once it began.
            if (m.role === 'assistant' && !m.parts.some((p) => (p.type === 'text' && p.text) || p.type === 'file' || isToolUIPart(p))) return null
            const ids = m.role === 'assistant' ? historyIds(m) : []
            const finished = m !== messages.at(-1) || !busy
            return (
              <Message key={m.id} from={m.role}>
                <MessageContent className="gap-1.5 group-[.is-assistant]:w-full">
                  {groupSteps(m.parts).map((p, i) => {
                    if (Array.isArray(p)) return <Steps key={p[0].toolCallId} parts={p} live={!finished} />
                    if (p.type === 'text') {
                      if (m.role === 'user') return <p key={i} className="whitespace-pre-wrap">{p.text}</p>
                      // A picture would be fetched by itself and a link can be clicked: either address could carry family data out.
                      return <MessageResponse key={i} isAnimating={!finished} skipHtml disallowedElements={['img', 'a']} unwrapDisallowed>{p.text}</MessageResponse>
                    }
                    if (p.type === 'file') return p.mediaType.startsWith('image/') ? <img key={i} src={p.url} alt={p.filename ?? ''} className="max-h-40 rounded-md" /> : <a key={i} href={p.url} className="flex items-center gap-1 text-xs underline"><FileText size={13} /> {p.filename}</a>
                    if (!isToolUIPart(p)) return null
                    const name = getToolName(p)
                    if (name === 'set_plan') return m.parts.findLast((x) => isToolUIPart(x) && getToolName(x) === 'set_plan') === p ? <Plan key={p.toolCallId} part={p as ToolUIPart} /> : null
                    return <ToolCall key={p.toolCallId} part={p as ToolUIPart} onAnswer={(approved) => addToolApprovalResponse({ id: p.approval!.id, approved })} onAllowEdits={isOrdinaryEdit(name) && !trusted ? allowEdits : undefined} />
                  })}
                  {m.role === 'assistant' && finished && <Stamped meta={m.metadata} />}
                  {ids.length > 0 && finished && !pending.length && !undone.includes(m.id) && (
                    <button className="bar-btn self-start border border-border !h-7" onClick={() => takeBack(m)}><Undo2 size={13} /> {t('Undo this answer\'s changes')}</button>
                  )}
                </MessageContent>
              </Message>
            )
          })}
          {busy && !visiblyWorking(messages.at(-1), status) && <Thinking />}
          {error && (
            <div role="alert" className="text-xs text-destructive">
              {plainError(error, t)} {!capped && <button className="underline" onClick={() => regenerate()}>{t('Try again')}</button>}
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {!messages.length && (
        <div className="flex flex-col items-center gap-2 px-3 pb-2 text-center">
          <h3 className="font-serif text-base font-medium">{t('Ask about the family')}</h3>
          <div className="flex flex-wrap justify-center gap-1.5">
            {['Who is the eldest in the family?', 'What is missing from the archive?', 'Who was born before 1900?'].map((q) => <button key={q} className="h-7 rounded-full border border-border bg-white px-3 text-xs text-ink-soft hover:text-ink" onClick={() => sendMessage({ text: t(q) })}>{t(q)}</button>)}
          </div>
        </div>
      )}
      {trusted && (
        <p className="flex items-center gap-2 border-t border-border px-3 py-1 text-xs text-ink-soft">
          <span className="flex-1">{t('Ordinary edits in this conversation run without asking')}</span>
          <button className="underline" onClick={forgetEdits}>{t('Ask again')}</button>
        </p>
      )}
      {demo && left && <p className="px-3 pt-1 text-xs text-ink-soft" data-demo-left>{t('Assistant messages left in this demo: {count}').replace('{count}', () => String(left.left))}</p>}
      <PromptInput className="composer px-2 pb-2 pt-1" multiple maxFileSize={40 * 1024 * 1024} onError={(e) => notify(e.message)} onSubmit={submit}>
        <AttachedFiles />
        <PromptInputBody>
          <PromptInputTextarea aria-label={t('Message to the assistant')} placeholder={capped ? capText : t(pending.length ? 'Answer the question above first' : 'Ask, or ask for a change…')} disabled={pending.length > 0 || capped} />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools><AttachButton /><DictateButton /><ModelPick userId={me.id} pick={pick} onPick={setPick} /></PromptInputTools>
          <PromptInputSubmit labels={{ send: t('Send'), stop: t('Stop') }} status={status} onStop={stop} disabled={pending.length > 0 || capped} className="size-7 rounded-full">{busy ? undefined : <ArrowUp className="size-4" />}</PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
    </aside>
  )
}

/** Earlier conversations on this device, newest first. */
function ChatHistory({ userId, current, onOpen, onForget }: { userId: string; current: string; onOpen: (c: SavedChat) => void; onForget: (c: SavedChat) => void }) {
  const { t, lang } = useApp()
  const [open, setOpen] = useState(false)
  const [chats, setChats] = useState<SavedChat[]>([])
  const show = (o: boolean) => { if (o) setChats(loadChats(userId)); setOpen(o) }
  const when = (at: number) => new Date(at).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <Popover open={open} onOpenChange={show}>
      <PopoverTrigger asChild><button className="bar-btn" title={t('Past conversations')} aria-label={t('Past conversations')}><History size={15} /></button></PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1">
        <p className="px-2 py-1 text-xs text-ink-soft">{t(chats.length ? 'Conversations are kept in this browser only' : 'No earlier conversations yet')}</p>
        <ul className="max-h-80 overflow-y-auto">
          {chats.map((c) => (
            <li key={c.id} className="flex items-center gap-1">
              <button className={`min-w-0 flex-1 rounded px-2 py-1.5 text-left hover:bg-black/5 ${c.id === current ? 'font-medium' : ''}`} onClick={() => { setOpen(false); onOpen(c) }}>
                <span className="block truncate text-sm">{c.title || t('Untitled')}</span>
                <span className="block text-xs text-ink-soft">{when(c.at)}</span>
              </button>
              <button className="bar-btn !h-7 shrink-0" title={t('Delete')} aria-label={t('Delete')} onClick={() => { onForget(c); setChats(loadChats(userId)) }}><X size={13} /></button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

const pickKey = (userId: string) => `folkbranch-model:${userId}`
function readPick(userId: string): { provider: string; model: string } | null {
  try { return JSON.parse(localStorage.getItem(pickKey(userId)) ?? 'null') } catch { return null }
}

/** The service and model for the next answers, from those the owner added; shown only when there is a choice. */
function ModelPick({ userId, pick, onPick }: { userId: string; pick: { provider: string; model: string } | null; onPick: (p: { provider: string; model: string } | null) => void }) {
  const { t } = useApp()
  const { data: choices = [] } = useQuery({ queryKey: ['assistant-choices'], queryFn: () => api<{ provider: string; label: string; model: string; modelLabel: string; current: boolean }[]>('assistant/choices'), staleTime: 60_000 })
  const value = pick ? `${pick.provider}|${pick.model}` : ''
  // A pick the owner has since removed falls back to the default.
  const known = !pick || choices.some((c) => `${c.provider}|${c.model}` === value)
  useEffect(() => { if (choices.length && !known) onPick(null) }, [choices.length, known, onPick])
  if (choices.length < 2) return null
  const choose = (v: string) => {
    const c = choices.find((x) => `${x.provider}|${x.model}` === v)
    const next = c && !c.current ? { provider: c.provider, model: c.model } : null
    onPick(next)
    try { if (next) localStorage.setItem(pickKey(userId), JSON.stringify(next)); else localStorage.removeItem(pickKey(userId)) } catch { /* private mode keeps it for this page only */ }
  }
  return (
    <Select look="quiet" className="max-w-[180px]" aria-label={t('Who answers')} title={t('Who answers')} value={known ? value : ''} onChange={choose}
      options={[{ value: '', label: t('The owner\'s choice') }, ...choices.map((c) => ({ value: `${c.provider}|${c.model}`, label: `${t(c.label)} · ${c.modelLabel}` }))]} />
  )
}

function AttachButton() {
  const { t } = useApp()
  const files = usePromptInputAttachments()
  return <PromptInputButton aria-label={t('Attach a file')} title={t('Attach a file')} onClick={() => files.openFileDialog()}><Paperclip size={15} /></PromptInputButton>
}

function AttachedFiles() {
  const { t } = useApp()
  const files = usePromptInputAttachments()
  if (!files.files.length) return null
  return (
    <div className="flex w-full flex-wrap gap-1 p-1 text-xs">
      {files.files.map((f) => (
        <span key={f.id} className="flex max-w-40 items-center gap-1 rounded border border-border px-1.5 py-0.5">
          <span className="truncate">{f.filename}</span>
          <button type="button" aria-label={t('Close')} onClick={() => files.remove(f.id)}><X size={11} /></button>
        </span>
      ))}
    </div>
  )
}

function ToolCall({ part, onAnswer, onAllowEdits }: { part: ToolUIPart; onAnswer: (approved: boolean) => void; onAllowEdits?: () => void }) {
  const { t, lang } = useApp()
  const name = getToolName(part)
  const label = toolLabel(name, lang)
  const reason = (part.approval as { requestReason?: string } | undefined)?.requestReason
  if (part.state === 'approval-requested') {
    return (
      <Confirmation approval={part.approval as never} state={part.state} className="flex flex-col gap-2">
        <ConfirmationRequest>
          <p className="font-medium">{t('The assistant asks for permission')}</p>
          <p className="mt-1 whitespace-pre-wrap text-ink-soft">{reason || label}</p>
        </ConfirmationRequest>
        <ConfirmationActions className="flex-wrap justify-start">
          <ConfirmationAction className="h-9" onClick={() => onAnswer(true)}>{t('Allow once')}</ConfirmationAction>
          {onAllowEdits && <ConfirmationAction className="h-9" variant="outline" onClick={onAllowEdits}>{t('Allow and stop asking')}</ConfirmationAction>}
          <ConfirmationAction className="h-9" variant="outline" onClick={() => onAnswer(false)}>{t('Decline')}</ConfirmationAction>
        </ConfirmationActions>
        {onAllowEdits && <p className="text-xs text-ink-soft">{t('“Allow and stop asking”: ordinary edits go ahead without asking until you start a new conversation.')}</p>}
      </Confirmation>
    )
  }
  if (part.state === 'output-denied') return <p className="text-xs text-ink-soft">{t('You declined')}: {label}{reason ? `. ${reason}` : ''}</p>
  const link = part.state === 'output-available' ? (part.output as { link?: string } | null)?.link : undefined
  return (
    <>
      <div className="tool-row" title={t(STATUS[part.state])}>
        <div className="flex items-center gap-1.5">
          {part.state === 'output-available' && !preliminary(part) ? <CircleCheck size={13} className="text-ink-faint" /> : part.state === 'output-error' ? <CircleX size={13} className="text-destructive" /> : <Loader2 size={13} className="animate-spin" />}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <StepSubject part={part} />
        </div>
      </div>
      {part.state === 'output-error' && <p className="text-xs text-destructive">{part.errorText}</p>}
      {link && <InviteLink link={link} />}
    </>
  )
}

/** What the step is about: the person it reads or writes, with a small avatar that opens them on the chart, or how many and how far. */
function StepSubject({ part }: { part: ToolUIPart }) {
  const { byId, focus, t } = useApp()
  const sub = subjectOf(getToolName(part), part.input, part.output)
  const person = sub.total === 1 ? byId.get(sub.ids[0]) : undefined
  const shown = person && !person.hidden ? person : undefined
  const text = stepDetail(sub, (id) => { const q = byId.get(id); return q && !q.hidden ? personName(q) : undefined }, t('of'))
  if (!text) return null
  return (
    <span className="step-subject flex min-w-0 flex-none items-center gap-1 text-ink-soft" data-subject={sub.ids.join(',')} data-progress={sub.done !== undefined ? `${sub.done}/${sub.total}` : undefined}>
      {shown && <button type="button" className="size-4 flex-none overflow-hidden rounded-full" aria-label={personName(shown)} onClick={() => focus(shown.id)}><img src={avatarUrl(shown)} alt="" className="size-full object-cover" /></button>}
      <span className="min-w-0 truncate">{text}</span>
    </span>
  )
}

/** The assistant's plan as a checklist: only the newest version in an answer is shown. */
function Plan({ part }: { part: ToolUIPart }) {
  const { t } = useApp()
  const steps = ((part.output ?? part.input) as { steps?: { text: string; done?: boolean }[] } | undefined)?.steps ?? []
  if (!steps.length) return null
  return (
    <div className="rounded-lg border border-border bg-white/70 px-2.5 py-2 text-xs">
      <p className="mb-1 font-medium">{t('Plan')}</p>
      <ol className="flex flex-col gap-1">
        {steps.map((s, i) => <li key={i} className={`flex items-start gap-1.5 ${s.done ? 'text-ink-faint line-through' : ''}`}>{s.done ? <CircleCheck size={13} className="mt-px shrink-0" /> : <Circle size={13} className="mt-px shrink-0 text-ink-faint" />}<span>{s.text}</span></li>)}
      </ol>
    </div>
  )
}

const RUNNING: ToolUIPart['state'][] = ['input-streaming', 'input-available', 'approval-responded']
/** Steps the assistant takes on its own (reading, looking, making an edit it was allowed): shown together, folded. */
const quiet = (p: UIMessage['parts'][number]): p is ToolUIPart => isToolUIPart(p) && getToolName(p) !== 'set_plan' && p.state !== 'approval-requested' && p.state !== 'output-denied'
/** The parts of a message with each run of quiet steps in one group, so they fold together and stay out of the answer. */
function groupSteps(parts: UIMessage['parts']) {
  const out: (UIMessage['parts'][number] | ToolUIPart[])[] = []
  for (const p of parts) {
    const last = out.at(-1)
    if (quiet(p)) { if (Array.isArray(last)) last.push(p); else out.push([p]) } else out.push(p)
  }
  return out
}
/** When the answer came and how long it took; on a long one the steps and tokens open under it. Nothing for an old message. */
function Stamped({ meta }: { meta: unknown }) {
  const { t, lang } = useApp()
  const s = stampOf(meta)
  if (!s) return null
  const detail = stampDetail(s, lang, t)
  const line = stampLine(s, lang, t)
  if (!detail) return <p className="answer-stamp text-xs text-ink-faint">{line}</p>
  return (
    <details className="answer-stamp text-xs text-ink-faint">
      <summary className="flex cursor-pointer list-none items-center gap-1">{line}<ChevronDown size={12} className="chev shrink-0" /></summary>
      <p className="mt-0.5">{detail}</p>
    </details>
  )
}

/** Whether the screen already shows the assistant at work: text arriving or a step running. Otherwise it is thinking. */
function visiblyWorking(m: UIMessage | undefined, status: string) {
  if (status === 'submitted' || !m || m.role !== 'assistant') return false
  const last = m.parts.at(-1)
  if (!last) return false
  if (last.type === 'text') return last.state === 'streaming' && last.text.length > 0
  return isToolUIPart(last) && (RUNNING.includes(last.state) || preliminary(last) || last.state === 'approval-requested')
}

/** Said at once after sending and whenever the model is quiet between steps, with the seconds it has been at it. */
function Thinking() {
  const { t } = useApp()
  const [s, setS] = useState(0)
  useEffect(() => { const i = setInterval(() => setS((n) => n + 1), 1000); return () => clearInterval(i) }, [])
  return (
    <p role="status" aria-live="polite" className="thinking flex items-center gap-2 text-sm text-ink-soft">
      <span className="thinking-dots" aria-hidden><i /><i /><i /></span>
      <span>{t('Thinking…')}{s >= 3 ? ` ${s} ${t('s')}` : ''}</span>
    </p>
  )
}

/**
 * A run of steps in one quiet line between the answer's sentences, in the order they were taken: the step under way
 * with a spinner, or what was done ("Ищет людей · Читает карточку"). More than one step folds open to the list.
 */
function Steps({ parts, live }: { parts: ToolUIPart[]; live: boolean }) {
  const { lang } = useApp()
  const current = live ? parts.findLast((p) => RUNNING.includes(p.state) || preliminary(p)) : undefined
  const failed = parts.some((p) => p.state === 'output-error')
  const [open, setOpen] = useState(false)
  // The same step done several times in a row is said once.
  const names = parts.map((p) => stepLabel(getToolName(p), lang)).filter((n, i, all) => n !== all[i - 1])
  const line = current ? `${stepLabel(getToolName(current), lang)}…` : names.join(' · ')
  const now = current ? <StepSubject part={current} /> : null
  const icon = current ? <Loader2 size={13} className="shrink-0 animate-spin" /> : failed ? <CircleX size={13} className="shrink-0 text-destructive" /> : <CircleCheck size={13} className="shrink-0 text-ink-faint" />
  if (parts.length === 1 && !failed) return <p className="tool-steps-line">{icon}<span className="min-w-0 flex-1 truncate">{line}</span>{now}</p>
  return (
    <details className="tool-steps" open={open || failed} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="tool-steps-line">
        {icon}<span className="min-w-0 flex-1 truncate">{line}</span>{now}<ChevronDown size={13} className="chev shrink-0" />
      </summary>
      <div className="flex flex-col gap-0.5 border-l border-border pl-3 ml-1.5 mt-0.5">
        {parts.map((p) => <ToolCall key={p.toolCallId} part={p} onAnswer={() => {}} />)}
      </div>
    </details>
  )
}

const STATUS: Record<ToolUIPart['state'], string> = {
  'input-streaming': 'Preparing', 'input-available': 'Working', 'approval-requested': 'Waiting', 'approval-responded': 'Working',
  'output-available': 'Done', 'output-error': 'Failed', 'output-denied': 'You declined',
}

/** The one thing only the person gets to see. */
function InviteLink({ link }: { link: string }) {
  const { t } = useApp()
  const [copied, setCopied] = useState(false)
  const url = `${location.origin}${link}`
  return (
    <div className="flex items-center gap-1 rounded-md border border-border p-1.5 text-xs">
      <span className="min-w-0 flex-1 truncate">{url}</span>
      <button className="bar-btn !h-7" aria-label={t('Copy')} onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(true))}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
    </div>
  )
}
