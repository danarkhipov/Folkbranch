'use client'
import { useEffect, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { useQueryClient } from '@tanstack/react-query'
import { DefaultChatTransport, getToolName, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses, type ToolUIPart, type UIMessage } from 'ai'
import { ArrowUp, Check, Circle, CircleCheck, CircleX, Copy, FileText, Loader2, Paperclip, Plus, Undo2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationRequest } from '@/components/ai-elements/confirmation'
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { PromptInput, PromptInputBody, PromptInputButton, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools, usePromptInputAttachments, type PromptInputMessage } from '@/components/ai-elements/prompt-input'
import { PanelEdge } from './panel-size'
import { changesData, isOrdinaryEdit, toolLabel } from '@/lib/agent/labels'
import { api, undoFailure, useApp } from '@/lib/client'

/** Told to the model after a person takes an answer back, so it does not build on what is gone. */
const TAKEN_BACK = '[Правки из этого ответа отменены]'

/** The server's words when it has them; never a raw response. */
function plainError(e: Error, t: (k: string) => string) {
  try { const said = JSON.parse(e.message)?.error; if (typeof said === 'string' && /[а-яё]/i.test(said)) return said } catch {}
  if (!e.message || e.message.startsWith('{') || e.message === 'The assistant could not answer. Try again.') return t('Ассистент не смог ответить.')
  return e.message
}

const historyIds = (m: UIMessage) => [...new Set(m.parts.flatMap((p) => (isToolUIPart(p) && p.state === 'output-available' && (p.output as { historyId?: string } | null)?.historyId ? [(p.output as { historyId: string }).historyId] : [])))]

export default function AssistantPanel({ open, width, onWidth, onClose, onPath, onDirection }: { open: boolean; width: number; onWidth: (w: number) => void; onClose: () => void; onPath: (path: string[]) => void; onDirection: (rootsBelow: boolean) => void }) {
  const { t, focusId, focus, notify } = useApp()
  const qc = useQueryClient()
  const router = useRouter()
  const trust = useRef(false)
  const [trusted, setTrusted] = useState(false)
  const focused = useRef(focusId)
  focused.current = focusId
  const [transport] = useState(() => new DefaultChatTransport({ api: '/api/agent', body: () => ({ trustWrites: trust.current, focusId: focused.current }) }))
  const { messages, sendMessage, status, stop, error, regenerate, addToolApprovalResponse, setMessages, clearError } = useChat({ transport, sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses })
  const busy = status === 'submitted' || status === 'streaming'
  const pending = messages.at(-1)?.parts.filter((p): p is ToolUIPart => isToolUIPart(p) && p.state === 'approval-requested') ?? []

  // What a finished tool means for the screen behind the chat.
  const applied = useRef(new Set<string>())
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
      await sendMessage({ text: text.trim() || t('Посмотри этот файл'), files: uploaded })
    } catch (e) {
      notify(`${t('Не удалось загрузить файл')}: ${(e as Error).message}`)
      throw e
    }
  }
  const [undone, setUndone] = useState<string[]>([])
  const takeBack = async (m: UIMessage) => {
    try {
      for (const id of historyIds(m).reverse()) await api(`history/${id}/undo`, { json: {} })
      setUndone((u) => [...u, m.id])
      setMessages((list) => [...list, { id: `taken-${m.id}`, role: 'user', parts: [{ type: 'text', text: TAKEN_BACK }] }])
      notify(t('Отменено'))
    } catch (e) {
      notify(undoFailure(e, t))
    }
    await qc.invalidateQueries()
  }

  return (
    <aside hidden={!open} aria-label={t('Ассистент')} style={{ width: `min(${width}px, calc(100vw - 24px))` }} className="assistant side-sheet float fixed left-3 top-[60px] bottom-3 z-10 flex flex-col !bg-[#fffdf8] text-sm [&[hidden]]:hidden">
      <PanelEdge width={width} onWidth={onWidth} />
      <header className="flex items-center gap-1 border-b border-border py-1 pl-3 pr-1">
        <h2 className="flex-1 font-serif text-lg font-medium">{t('Ассистент')}</h2>
        {messages.length > 0 && <button className="bar-btn" onClick={restart}><Plus size={15} /> {t('Новый разговор')}</button>}
        <button className="bar-btn" title={t('Закрыть')} aria-label={t('Закрыть')} onClick={onClose}><X size={15} /></button>
      </header>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="gap-3 p-3">
          {messages.map((m) => {
            if (m.role === 'user' && m.id.startsWith('taken-')) return <p key={m.id} className="text-center text-xs text-ink-soft">{t('Правки из этого ответа отменены')}</p>
            const ids = m.role === 'assistant' ? historyIds(m) : []
            const finished = m !== messages.at(-1) || !busy
            return (
              <Message key={m.id} from={m.role}>
                <MessageContent className="gap-1.5 group-[.is-assistant]:w-full">
                  {m.parts.map((p, i) => {
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
                  {ids.length > 0 && finished && !pending.length && !undone.includes(m.id) && (
                    <button className="bar-btn self-start border border-border !h-7" onClick={() => takeBack(m)}><Undo2 size={13} /> {t('Отменить правки из этого ответа')}</button>
                  )}
                </MessageContent>
              </Message>
            )
          })}
          {status === 'submitted' && <p role="status" className="text-xs text-ink-soft">{t('Думает…')}</p>}
          {error && (
            <div role="alert" className="text-xs text-destructive">
              {plainError(error, t)} <button className="underline" onClick={() => regenerate()}>{t('Повторить')}</button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {!messages.length && (
        <div className="flex flex-col items-center gap-2 px-3 pb-2 text-center">
          <h3 className="font-serif text-base font-medium">{t('Спросите о семье')}</h3>
          <div className="flex flex-wrap justify-center gap-1.5">
            {['Кто самый старший в семье?', 'Чего не хватает в архиве?', 'Кто родился до 1900 года?'].map((q) => <button key={q} className="h-7 rounded-full border border-border bg-white px-3 text-xs text-ink-soft hover:text-ink" onClick={() => sendMessage({ text: t(q) })}>{t(q)}</button>)}
          </div>
        </div>
      )}
      {trusted && (
        <p className="flex items-center gap-2 border-t border-border px-3 py-1 text-xs text-ink-soft">
          <span className="flex-1">{t('Обычные правки в этом разговоре идут без вопросов')}</span>
          <button className="underline" onClick={forgetEdits}>{t('Спрашивать снова')}</button>
        </p>
      )}
      <PromptInput className="composer px-2 pb-2 pt-1" multiple maxFileSize={40 * 1024 * 1024} onError={(e) => notify(e.message)} onSubmit={submit}>
        <AttachedFiles />
        <PromptInputBody>
          <PromptInputTextarea aria-label={t('Сообщение ассистенту')} placeholder={t(pending.length ? 'Сначала ответьте на вопрос выше' : 'Спросите или попросите изменить…')} disabled={pending.length > 0} />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools><AttachButton /></PromptInputTools>
          <PromptInputSubmit labels={{ send: t('Отправить'), stop: t('Остановить') }} status={status} onStop={stop} disabled={pending.length > 0} className="size-7 rounded-full">{busy ? undefined : <ArrowUp className="size-4" />}</PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
    </aside>
  )
}

function AttachButton() {
  const { t } = useApp()
  const files = usePromptInputAttachments()
  return <PromptInputButton aria-label={t('Прикрепить файл')} title={t('Прикрепить файл')} onClick={() => files.openFileDialog()}><Paperclip size={15} /></PromptInputButton>
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
          <button type="button" aria-label={t('Закрыть')} onClick={() => files.remove(f.id)}><X size={11} /></button>
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
          <p className="font-medium">{t('Ассистент просит разрешения')}</p>
          <p className="mt-1 whitespace-pre-wrap text-ink-soft">{reason || label}</p>
        </ConfirmationRequest>
        <ConfirmationActions className="flex-wrap justify-start">
          <ConfirmationAction className="h-9" onClick={() => onAnswer(true)}>{t('Разрешить один раз')}</ConfirmationAction>
          {onAllowEdits && <ConfirmationAction className="h-9" variant="outline" onClick={onAllowEdits}>{t('Разрешить до конца разговора')}</ConfirmationAction>}
          <ConfirmationAction className="h-9" variant="outline" onClick={() => onAnswer(false)}>{t('Отказать')}</ConfirmationAction>
        </ConfirmationActions>
        {onAllowEdits && <p className="text-xs text-ink-soft">{t('«Разрешить до конца разговора»: правки пойдут без вопросов, пока вы не начнёте новый разговор.')}</p>}
      </Confirmation>
    )
  }
  if (part.state === 'output-denied') return <p className="text-xs text-ink-soft">{t('Вы отказали')}: {label}{reason ? `. ${reason}` : ''}</p>
  const link = part.state === 'output-available' ? (part.output as { link?: string } | null)?.link : undefined
  return (
    <>
      <div className="tool-row" title={t(STATUS[part.state])}>
        <div className="flex items-center gap-1.5">
          {part.state === 'output-available' ? <CircleCheck size={13} className="text-ink-faint" /> : part.state === 'output-error' ? <CircleX size={13} className="text-destructive" /> : <Loader2 size={13} className="animate-spin" />}
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </div>
      </div>
      {part.state === 'output-error' && <p className="text-xs text-destructive">{part.errorText}</p>}
      {link && <InviteLink link={link} />}
    </>
  )
}

/** The assistant's plan as a checklist: only the newest version in an answer is shown. */
function Plan({ part }: { part: ToolUIPart }) {
  const { t } = useApp()
  const steps = ((part.output ?? part.input) as { steps?: { text: string; done?: boolean }[] } | undefined)?.steps ?? []
  if (!steps.length) return null
  return (
    <div className="rounded-lg border border-border bg-white/70 px-2.5 py-2 text-xs">
      <p className="mb-1 font-medium">{t('План')}</p>
      <ol className="flex flex-col gap-1">
        {steps.map((s, i) => <li key={i} className={`flex items-start gap-1.5 ${s.done ? 'text-ink-faint line-through' : ''}`}>{s.done ? <CircleCheck size={13} className="mt-px shrink-0" /> : <Circle size={13} className="mt-px shrink-0 text-ink-faint" />}<span>{s.text}</span></li>)}
      </ol>
    </div>
  )
}

const STATUS: Record<ToolUIPart['state'], string> = {
  'input-streaming': 'Готовит', 'input-available': 'Выполняет', 'approval-requested': 'Ждёт ответа', 'approval-responded': 'Выполняет',
  'output-available': 'Готово', 'output-error': 'Не получилось', 'output-denied': 'Вы отказали',
}

/** The one thing only the person gets to see. */
function InviteLink({ link }: { link: string }) {
  const { t } = useApp()
  const [copied, setCopied] = useState(false)
  const url = `${location.origin}${link}`
  return (
    <div className="flex items-center gap-1 rounded-md border border-border p-1.5 text-xs">
      <span className="min-w-0 flex-1 truncate">{url}</span>
      <button className="bar-btn !h-7" aria-label={t('Скопировать')} onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(true))}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
    </div>
  )
}
