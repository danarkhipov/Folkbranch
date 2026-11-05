'use client'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Copy, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api, useApp, useProposals } from '@/lib/client'
import { ModelSelect, ProviderForm, useProviderStatus } from './assistant-setup'
import type { PresetId } from '@/lib/agent/presets'
import { layoutFamily, AVATAR_CY, CARD_H } from '@/lib/graph/layout'
import { parseFamilyText, parsedToGraph, planFamilyText, serializeFamilyText, type TextPlan } from '@/lib/textformat'
import { personName } from '@/lib/types'

/** The drafts a token has written: every line in words, accepted or rejected by a person. */
export function ReviewPanel({ onClose }: { onClose: () => void }) {
  const { t } = useApp()
  const qc = useQueryClient()
  const { data: drafts = [] } = useProposals(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    await fn().catch((e) => setError(String(e.message ?? e)))
    await qc.invalidateQueries()
    setBusy(false)
  }
  return (
    <div className="float side-sheet fixed left-3 top-[60px] bottom-3 w-96 max-w-[calc(100vw-24px)] flex flex-col z-10">
      <div className="flex items-center justify-between px-3 pt-3 pb-2"><h3 className="font-serif font-medium text-lg">{t('Правки ассистента')}</h3><button className="text-ink-faint hover:text-ink" aria-label={t('Закрыть')} title={t('Закрыть')} onClick={onClose}><X size={15} /></button></div>
      <div className="flex-1 overflow-auto px-3 pb-3 flex flex-col gap-4">
        {!drafts.length && <p className="text-sm text-ink-faint">{t('Правок на проверку нет')}</p>}
        {drafts.map((d) => (
          <section key={d.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-xs text-ink-soft"><b className="font-medium text-ink">{d.tokenName}</b><span>{d.ops.length} {t('правок')}</span></div>
            {d.error && <p className="text-xs text-destructive flex gap-1"><AlertTriangle size={13} className="flex-none mt-px" /> {d.error}</p>}
            <div className="flex flex-col rounded-lg border border-border divide-y divide-border max-h-[50vh] overflow-auto bg-white/60">
              {d.ops.map((o, i) => (
                <div key={i} className="group flex gap-2 px-2 py-1.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="leading-snug break-words">{o.text}</div>
                    {o.details?.map((line, j) => <div key={j} className="text-xs text-ink-soft break-words">{line}</div>)}
                  </div>
                  <button title={t('Удалить')} disabled={busy} className="hidden group-hover:block text-ink-faint hover:text-destructive flex-none self-start" onClick={() => act(() => api(`proposals/${d.id}/ops/${i}`, { method: 'DELETE' }))}><X size={13} /></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button className="bar-btn on" disabled={busy} onClick={() => act(() => api(`proposals/${d.id}/accept`, { json: {} }))}><Check size={14} /> {t('Принять')}</button>
              <button className="bar-btn border border-border" disabled={busy} onClick={() => act(() => api(`proposals/${d.id}/reject`, { json: {} }))}>{t('Отклонить')}</button>
            </div>
          </section>
        ))}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  )
}

interface TokenRow { id: string; name: string; role: 'reader' | 'editor'; review: boolean; lastUsedAt: number | null; revokedAt: number | null; expiresAt: number | null }

type Client = 'claude' | 'json' | 'prompt'
const CLIENTS: Record<Client, string> = { claude: 'Claude Code', json: 'Cursor и другие', prompt: 'Задание агенту' }

/** Which provider answers, and changing it. */
function ProviderSettings() {
  const { t } = useApp()
  const qc = useQueryClient()
  const { data } = useProviderStatus()
  const [changing, setChanging] = useState(false)
  const [modelError, setModelError] = useState('')
  if (!data) return null
  const changeModel = async (model: string) => {
    if (!model.trim()) return
    setModelError('')
    try {
      await api('assistant/provider', { method: 'PATCH', json: { model } })
      await qc.invalidateQueries({ queryKey: ['provider'] })
    } catch (e) {
      setModelError((e as Error).message)
    }
  }
  const remove = async () => {
    await api('assistant/provider', { method: 'DELETE' })
    await qc.invalidateQueries({ queryKey: ['provider'] })
    location.reload()
  }
  return (
    <div className="my-1 flex flex-col gap-2">
      {data.connected ? (
        <p className="text-xs text-ink-soft">{t('Сервис')}: {data.label}{data.keyEnding ? `, ${t('ключ')} …${data.keyEnding}` : ''}{data.source === 'server' ? `. ${t('Ключ уже настроен')}` : ''}</p>
      ) : <p className="text-xs text-destructive">{t('Ключ не задан: ассистент не может отвечать')}</p>}
      {data.source === 'app' && !changing && <ModelSelect key={data.provider} presetId={data.provider as PresetId} value={data.model ?? ''} onChange={changeModel} />}
      {modelError && <p role="alert" className="text-xs text-destructive">{modelError}</p>}
      {data.source !== 'server' && (changing || !data.connected ? <ProviderForm onDone={() => setChanging(false)} /> : (
        <div className="flex gap-3 text-xs">
          <button type="button" className="bar-btn border border-border" onClick={() => setChanging(true)}>{t('Сменить ключ')}</button>
          <button type="button" className="bar-btn border border-border" onClick={remove}>{t('Удалить ключ')}</button>
        </div>
      ))}
    </div>
  )
}

/** The built-in assistant: off until the owner connects a provider. */
export function AssistantSettings() {
  const { t } = useApp()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<{ assistantEnabled: boolean; assistantForReaders: boolean; assistantProvider: string | null; assistantModel: string | null }>('settings') })
  if (!data) return null
  const set = async (key: string, on: boolean) => {
    await api('settings', { method: 'PATCH', json: { [key]: on ? '1' : '0' } })
    await qc.invalidateQueries({ queryKey: ['settings'] })
    location.reload()
  }
  const row = (key: 'assistantEnabled' | 'assistantForReaders', label: string, off = false) => (
    <label className="flex items-center gap-2 min-h-7"><input type="checkbox" className="accent-[var(--ink)] size-4" disabled={off} checked={data[key]} onChange={(e) => set(key, e.target.checked)} /> {t(label)}</label>
  )
  return (
    <section className="flex flex-col gap-2 text-sm">
      <p className="text-xs text-ink-soft">{t('Чат внутри приложения: отвечает на вопросы о семье и вносит правки с вашего подтверждения.')}</p>
      <ProviderSettings />
      {row('assistantEnabled', 'Включить ассистента')}
      {row('assistantForReaders', 'Разрешить читателям пользоваться ассистентом', !data.assistantEnabled)}
    </section>
  )
}

export function TokensTab() {
  const { t, lang } = useApp()
  const qc = useQueryClient()
  const { data: rows = [] } = useQuery({ queryKey: ['tokens'], queryFn: () => api<TokenRow[]>('tokens') })
  const [name, setName] = useState('')
  const [role, setRole] = useState<'reader' | 'editor'>('reader')
  const [review, setReview] = useState(true)
  const [days, setDays] = useState('')
  const [made, setMade] = useState('')
  const [copied, setCopied] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['tokens'] })
  const origin = typeof location === 'undefined' ? '' : location.origin
  const [client, setClient] = useState<Client>('claude')
  const snippet = client === 'claude'
    ? `claude mcp add --transport http family ${origin}/api/mcp --header "Authorization: Bearer ${made}"`
    : client === 'json'
      ? JSON.stringify({ mcpServers: { family: { type: 'http', url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${made}` } } } }, null, 2)
      : t('Подключись к семейному архиву по MCP. Сначала вызови get_overview, затем find_gaps. Прежде чем создавать человека, ищи его через search_people. Каждое найденное значение записывай через add_version с источником и его достоверностью, а не перезаписывай поля.')
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' })
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-xs text-ink-soft">{t('Подключение других программ к архиву. Обычно это не нужно.')}</p>
      <form className="flex flex-col gap-2" onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim()) return
        const r = await api<{ token: string }>('tokens', { json: { name: name.trim(), role, review, expiresInDays: days ? Number(days) : null } })
        setMade(r.token)
        setCopied(false)
        setName('')
        refresh()
      }}>
                <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
          <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Название ключа')}
            <input className="h-9 min-w-0 rounded-lg border border-input bg-white px-3 text-sm text-ink" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Что сможет делать')}
            <select className="h-9 rounded-lg border border-input bg-white px-2 text-sm text-ink" value={role} onChange={(e) => setRole(e.target.value as 'reader' | 'editor')}>
              <option value="reader">{t('читатель')}</option>
              <option value="editor">{t('редактор')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Срок действия')}
            <select className="h-9 rounded-lg border border-input bg-white px-2 text-sm text-ink" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="">{t('бессрочно')}</option>
              <option value="1">{t('на день')}</option>
              <option value="30">{t('на месяц')}</option>
              <option value="365">{t('на год')}</option>
            </select>
          </label>
        </div>
        <button className="h-9 self-start px-3 rounded-lg bg-ink text-white whitespace-nowrap disabled:opacity-40" disabled={!name.trim()}>{t('Создать ключ доступа')}</button>
        {role === 'editor' && <label className="flex items-center gap-2 text-ink-soft"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> {t('Правки через проверку')}</label>}
        <p className="text-xs text-ink-soft">{t(role === 'editor' ? 'Ключ редактора видит живых родственников, и эти данные уйдут к поставщику нейросети.' : 'Ключ только для чтения не видит живых родственников.')}</p>
      </form>
      {made && (
        <div className="rounded-lg bg-muted p-2 flex flex-col gap-1.5">
          <p className="text-xs text-ink-soft">{t('Ключ показан один раз, сохраните его.')}</p>
          <div role="radiogroup" aria-label={t('Куда подключить')} className="inline-flex self-start rounded-lg bg-background p-0.5 gap-0.5 text-xs">
            {(Object.keys(CLIENTS) as Client[]).map((c) => <button key={c} type="button" role="radio" aria-checked={client === c} className={client === c ? 'h-7 px-2 rounded-md bg-white shadow-sm font-medium' : 'h-7 px-2 rounded-md text-ink-soft hover:text-ink'} onClick={() => { setClient(c); setCopied(false) }}>{t(CLIENTS[c])}</button>)}
          </div>
          <code className="text-xs break-all whitespace-pre-wrap">{snippet}</code>
          <button className="flex items-center gap-1 text-xs text-ink-soft hover:text-ink self-start" onClick={() => { navigator.clipboard.writeText(snippet); setCopied(true) }}>{copied ? <Check size={13} /> : <Copy size={13} />}{t(copied ? 'Скопировано' : 'Скопировать')}</button>
        </div>
      )}
      <section>
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 py-1">
            <span className="truncate flex-1">{r.name}</span>
            <span className="text-xs text-ink-faint whitespace-nowrap">
              {t(r.role === 'reader' ? 'читатель' : r.review ? 'Правки через проверку' : 'Правит сразу')}
              {r.lastUsedAt ? ` · ${t('последнее использование')} ${fmt.format(r.lastUsedAt)}` : ''}
              {r.expiresAt ? ` · ${t(r.expiresAt < Date.now() ? 'истёк' : 'действует до')} ${fmt.format(r.expiresAt)}` : ''}
            </span>
            {r.revokedAt ? <span className="text-xs text-ink-faint">{t('Отозван')}</span> : <button className="text-xs text-ink-soft hover:text-destructive" onClick={async () => { await api(`tokens/${r.id}`, { method: 'DELETE' }); refresh() }}>{t('Отменить')}</button>}
          </div>
        ))}
      </section>
      <p className="text-xs"><a className="underline" href="/api/v1/openapi.json" target="_blank">{t('Описание для разработчиков')}</a></p>
    </div>
  )
}

export function MiniGraph({ text }: { text: string }) {
  const { rootsBelow } = useApp()
  const layout = useMemo(() => {
    try {
      const g = parsedToGraph(parseFamilyText(text))
      return g.persons.length ? { g, l: layoutFamily(g, { rootsBelow }) } : null
    } catch {
      return null
    }
  }, [text, rootsBelow])
  if (!layout) return null
  const { g, l } = layout
  const b = l.bounds
  return (
    <svg viewBox={`${b.x - 10} ${b.y - 10} ${b.w + 20} ${b.h + 20}`} className="w-full h-full">
      {l.edges.map((e) => <path key={e.id} d={e.path} className={e.style === 'solid' ? 'line' : `line ${e.style}`} />)}
      {l.unions.map((u) => <path key={u.id} d={u.path} className="union" />)}
      {l.unions.map((u) => <circle key={u.id} cx={u.x} cy={u.y} r={4.5} className="dot" />)}
      {g.persons.map((p) => {
        const c = l.cards.get(p.id)
        if (!c) return null
        return (
          <g key={p.id}>
            <circle cx={c.x} cy={c.y + AVATAR_CY} r={26} fill="#e7dfcd" stroke="#fffdf8" strokeWidth={3} />
            <text x={c.x} y={c.y + CARD_H - 34} textAnchor="middle" className="font-serif" fontSize={14} fill="var(--ink)">{personName(p).slice(0, 22)}</text>
            <text x={c.x} y={c.y + CARD_H - 17} textAnchor="middle" fontSize={11} fill="var(--ink-soft)">{[p.birthDate, p.deathDate].filter(Boolean).join(' – ')}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** What a text import will do, and the questions it needs answered first. */
export function PlanSummary({ plan, choices, onChoose }: { plan: TextPlan; choices: Record<string, string>; onChoose: (c: Record<string, string>) => void }) {
  const { t } = useApp()
  return (
    <>
      {plan.errors.map((e, i) => <p key={i} className="text-xs text-destructive">{t('Ошибка в строке')} {e.line}: {e.message}</p>)}
      {plan.ambiguous.map((a) => (
        <label key={a.ref} className="flex items-center gap-2 text-xs">
          <span className="text-rust">{t('Несколько совпадений')}: {a.name}</span>
          <select className="border border-input rounded bg-white px-1 py-0.5 min-w-0" value={choices[a.ref] ?? ''} onChange={(e) => onChoose({ ...choices, [a.ref]: e.target.value })}>
            <option value="" disabled>—</option>
            {a.candidates.map((c) => <option key={c.id} value={c.id}>{c.name} {c.years}</option>)}
            <option value="new">{t('Новый человек')}</option>
          </select>
        </label>
      ))}
      {!plan.ops.length && !plan.errors.length && !plan.ambiguous.length && <p className="text-xs text-ink-faint">{t('Изменений нет')}</p>}
      {plan.creates.length > 0 && <p className="text-xs"><b className="font-medium">{t('Добавится')} ({plan.creates.length}):</b> {plan.creates.slice(0, 12).join(', ')}{plan.creates.length > 12 ? '…' : ''}</p>}
      {plan.updates.length > 0 && <p className="text-xs"><b className="font-medium">{t('Изменится')} ({plan.updates.length}):</b> {plan.updates.slice(0, 12).join(', ')}{plan.updates.length > 12 ? '…' : ''}</p>}
      {plan.relations > 0 && <p className="text-xs"><b className="font-medium">{t('Связей')}:</b> +{plan.relations}</p>}
    </>
  )
}

/** The graph as editable text, with the result visible before anything is written. */
export function TextDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, graph, familyName, canEdit } = useApp()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (open) {
      setText(serializeFamilyText(graph, familyName))
      setChoices({})
      setError('')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planFamilyText(parseFamilyText(text), graph, choices), [text, graph, choices])
  const blocked = plan.errors.length > 0 || plan.ambiguous.length > 0 || !plan.ops.length
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(1200px,calc(100vw-32px))] sm:max-w-[min(1200px,calc(100vw-32px))] h-[calc(100vh-64px)] flex flex-col gap-3">
        <DialogTitle className="font-serif font-medium text-lg">{t('Текстовый вид графа')}</DialogTitle>
        <div className="grid md:grid-cols-2 gap-3 flex-1 min-h-0">
          <textarea value={text} readOnly={!canEdit} spellCheck={false} onChange={(e) => setText(e.target.value)} className="min-h-0 h-full resize-none rounded-lg border border-input bg-white p-3 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-ring/40 whitespace-pre" />
          <div className="min-h-0 flex flex-col gap-2">
            <div className="flex-1 min-h-0 rounded-lg bg-paper border border-border overflow-hidden"><MiniGraph text={text} /></div>
            <div className="text-sm flex flex-col gap-1 max-h-[40%] overflow-auto">
              <PlanSummary plan={plan} choices={choices} onChoose={setChoices} />
            </div>
          </div>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="bar-btn" onClick={() => { navigator.clipboard.writeText(text); setCopied(true) }}>{copied ? <Check size={14} /> : <Copy size={14} />} {t(copied ? 'Скопировано' : 'Скопировать')}</button>
          {canEdit && <button className="bar-btn on disabled:opacity-40" disabled={blocked} onClick={async () => {
            setError('')
            try {
              await api('text/import', { json: { text, resolutions: choices } })
              await qc.invalidateQueries()
              onOpenChange(false)
            } catch (e) {
              setError(String((e as Error).message))
            }
          }}>{t('Применить')}</button>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
