'use client'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Copy, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api, useApp } from '@/lib/client'
import { layoutFamily, AVATAR_CY, CARD_H } from '@/lib/graph/layout'
import type { Proposal } from '@/lib/ops/registry'
import { parseFamilyText, parsedToGraph, planFamilyText, serializeFamilyText } from '@/lib/textformat'
import { personName } from '@/lib/types'

export function useProposals(enabled: boolean) {
  return useQuery({ queryKey: ['proposals'], queryFn: () => api<Proposal[]>('proposals'), enabled, refetchInterval: 30_000 })
}

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
    <div className="float fixed left-3 top-[60px] bottom-3 w-96 max-w-[calc(100vw-24px)] flex flex-col z-10">
      <div className="flex items-center justify-between px-3 pt-3 pb-2"><h3 className="font-serif font-medium text-[15px]">{t('Правки ИИ')}</h3><button className="text-ink-faint hover:text-ink" onClick={onClose}><X size={15} /></button></div>
      <div className="flex-1 overflow-auto px-3 pb-3 flex flex-col gap-4">
        {!drafts.length && <p className="text-[13px] text-ink-faint">{t('Правок на проверку нет')}</p>}
        {drafts.map((d) => (
          <section key={d.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-xs text-ink-soft"><b className="font-medium text-ink">{d.tokenName}</b><span>{d.ops.length} {t('правок')}</span></div>
            {d.error && <p className="text-xs text-destructive flex gap-1"><AlertTriangle size={13} className="flex-none mt-px" /> {d.error}</p>}
            <div className="flex flex-col rounded-lg border border-border divide-y divide-border max-h-[50vh] overflow-auto bg-white/60">
              {d.ops.map((o, i) => (
                <div key={i} className="group flex gap-2 px-2 py-1.5 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <div className="leading-snug break-words">{o.text}</div>
                    {o.details?.map((line, j) => <div key={j} className="text-[11px] text-ink-soft break-words">{line}</div>)}
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

interface TokenRow { id: string; name: string; role: 'reader' | 'editor'; review: boolean; lastUsedAt: number | null; revokedAt: number | null }

export function TokensTab() {
  const { t, lang } = useApp()
  const qc = useQueryClient()
  const { data: rows = [] } = useQuery({ queryKey: ['tokens'], queryFn: () => api<TokenRow[]>('tokens') })
  const [name, setName] = useState('')
  const [role, setRole] = useState<'reader' | 'editor'>('reader')
  const [review, setReview] = useState(true)
  const [made, setMade] = useState('')
  const [copied, setCopied] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['tokens'] })
  const origin = typeof location === 'undefined' ? '' : location.origin
  const command = `claude mcp add --transport http family ${origin}/api/mcp --header "Authorization: Bearer ${made}"`
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' })
  return (
    <div className="flex flex-col gap-4 pt-2 text-[13px]">
      <form className="flex flex-col gap-2" onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim()) return
        const r = await api<{ token: string }>('tokens', { json: { name: name.trim(), role, review } })
        setMade(r.token)
        setCopied(false)
        setName('')
        refresh()
      }}>
        <div className="flex gap-2 flex-wrap">
          <input className="h-9 flex-1 min-w-32 rounded-lg border border-input bg-white px-3" placeholder={t('Название токена')} value={name} onChange={(e) => setName(e.target.value)} />
          <select className="h-9 rounded-lg border border-input bg-white px-2" value={role} onChange={(e) => setRole(e.target.value as 'reader' | 'editor')}>
            <option value="reader">{t('только чтение')}</option>
            <option value="editor">{t('редактор')}</option>
          </select>
          <button className="h-9 px-3 rounded-lg bg-ink text-white whitespace-nowrap disabled:opacity-40" disabled={!name.trim()}>{t('Создать токен')}</button>
        </div>
        {role === 'editor' && <label className="flex items-center gap-2 text-ink-soft"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> {t('Правки через проверку')}</label>}
        <p className="text-xs text-ink-soft">{t(role === 'editor' ? 'Токен редактора видит живых родственников, и эти данные уйдут к поставщику нейросети.' : 'Токен только для чтения не видит живых родственников.')}</p>
      </form>
      {made && (
        <div className="rounded-lg bg-muted p-2 flex flex-col gap-1.5">
          <p className="text-xs text-ink-soft">{t('Токен показан один раз, сохраните его.')}</p>
          <code className="text-xs break-all">{command}</code>
          <button className="flex items-center gap-1 text-xs text-ink-soft hover:text-ink self-start" onClick={() => { navigator.clipboard.writeText(command); setCopied(true) }}>{copied ? <Check size={13} /> : <Copy size={13} />}{t(copied ? 'Скопировано' : 'Скопировать')}</button>
        </div>
      )}
      <section>
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 py-1">
            <span className="truncate flex-1">{r.name}</span>
            <span className="text-xs text-ink-faint whitespace-nowrap">
              {t(r.role === 'reader' ? 'только чтение' : r.review ? 'Правки через проверку' : 'Правит сразу')}
              {r.lastUsedAt ? ` · ${t('последнее использование')} ${fmt.format(r.lastUsedAt)}` : ''}
            </span>
            {r.revokedAt ? <span className="text-xs text-ink-faint">{t('Отозван')}</span> : <button className="text-xs text-ink-soft hover:text-destructive" onClick={async () => { await api(`tokens/${r.id}`, { method: 'DELETE' }); refresh() }}>{t('Отозвать')}</button>}
          </div>
        ))}
      </section>
      <p className="text-xs text-ink-faint">REST: <a className="underline" href="/api/v1/openapi.json" target="_blank">/api/v1/openapi.json</a></p>
    </div>
  )
}

function MiniGraph({ text }: { text: string }) {
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
            <div className="text-[13px] flex flex-col gap-1 max-h-[40%] overflow-auto">
              {plan.errors.map((e, i) => <p key={i} className="text-xs text-destructive">{t('Ошибка в строке')} {e.line}: {e.message}</p>)}
              {plan.ambiguous.map((a) => (
                <label key={a.ref} className="flex items-center gap-2 text-xs">
                  <span className="text-rust">{t('Несколько совпадений')}: {a.name}</span>
                  <select className="border border-input rounded bg-white px-1 py-0.5 min-w-0" value={choices[a.ref] ?? ''} onChange={(e) => setChoices({ ...choices, [a.ref]: e.target.value })}>
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
