'use client'
import { ImportDialog } from './import-dialog'
import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Copy, Trash2, Undo2, X, Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, useApp, useWrite } from '@/lib/client'
import { cn } from '@/lib/utils'
import { personName, type HistoryEntry, type Lang, type Role } from '@/lib/types'
import { Mini, PersonPopover } from './person-pickers'
import { TokensTab } from './ai-panels'

/** "Кем приходится?": two people, an answer in words, the path lit on the graph. */
export function HowRelated({ onPath, onClose }: { onPath: (ids: string[] | null) => void; onClose: () => void }) {
  const { t, byId, family, lang, me } = useApp()
  const [a, setA] = useState<string | null>(me.personId)
  const [b, setB] = useState<string | null>(null)
  const kin = useMemo(() => (a && b && a !== b ? family.relation(a, b, lang) : null), [a, b, family, lang])
  const lastPath = useRef<string>('')
  const key = kin?.path.join() ?? ''
  if (key !== lastPath.current) {
    lastPath.current = key
    queueMicrotask(() => onPath(kin?.path ?? null))
  }
  const slot = (id: string | null, set: (v: string) => void, placeholder: string) => {
    const p = id ? byId.get(id) : null
    return (
      <PersonPopover onPick={set}>
        <button className="flex items-center gap-2 h-9 px-2 rounded-lg border border-input bg-white w-full text-left text-[13px]">
          {p ? <><Mini person={p} /> <span className="truncate">{personName(p)}</span></> : <span className="text-ink-faint">{t(placeholder)}</span>}
        </button>
      </PersonPopover>
    )
  }
  return (
    <div className="float fixed left-3 top-[60px] w-80 p-3 z-10 flex flex-col gap-2">
      <div className="flex items-center justify-between"><h3 className="font-serif font-medium text-[15px]">{t('Кем приходится?')}</h3><button className="text-ink-faint hover:text-ink" onClick={onClose}><X size={15} /></button></div>
      {slot(a, setA, 'Первый человек')}
      {slot(b, setB, 'Второй человек')}
      {a && b && a !== b && !kin && <p className="text-[13px] text-ink-soft">{t('Кровного родства и связи через брак не найдено')}</p>}
      {kin && (
        <div className="pt-1">
          <p className="font-serif text-[17px] leading-snug"><span className="text-rust">{kin.label}</span></p>
          <p className="text-xs text-ink-soft">{personName(byId.get(b!)!)} — {lang === 'en' ? 'to' : 'для'} {personName(byId.get(a!)!)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-ink-soft">
            {kin.path.map((id, i) => (
              <span key={id} className="flex items-center gap-1">
                {i > 0 && <ArrowRight size={11} className="text-ink-faint" />}
                {personName(byId.get(id)!) || t('Скрыто')}
                {i > 0 && <span className="text-ink-faint">({family.relation(kin.path[i - 1], id, lang)?.label})</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const { t, canEdit, lang, focus, byId } = useApp()
  const { data: rows = [] } = useQuery({ queryKey: ['history'], queryFn: () => api<HistoryEntry[]>('history') })
  const qc = useQueryClient()
  const undo = useWrite((id: string) => api(`history/${id}/undo`, { json: {} }).then(() => { qc.invalidateQueries() }))
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="float fixed left-3 top-[60px] bottom-3 w-80 flex flex-col z-10">
      <div className="flex items-center justify-between px-3 pt-3 pb-2"><h3 className="font-serif font-medium text-[15px]">{t('Что нового')}</h3><button className="text-ink-faint hover:text-ink" onClick={onClose}><X size={15} /></button></div>
      <div className="flex-1 overflow-auto px-1.5 pb-2">
        {!rows.length && <p className="px-2 text-[13px] text-ink-faint">{t('Пока ничего не менялось')}</p>}
        {rows.map((r) => (
          <div key={r.id} className={cn('group rounded-md px-2 py-1.5 hover:bg-muted', r.undoneAt && 'opacity-50')}>
            <button className="text-left text-[13px] leading-snug" onClick={() => r.personIds[0] && byId.has(r.personIds[0]) && focus(r.personIds[0], { center: true })}>{r.summary}</button>
            <div className="flex items-center text-[11px] text-ink-faint mt-0.5">
              <span>{r.actorName} · {fmt.format(r.at)}</span>
              {r.undoneAt && <span className="ml-2">{t('Отменено')}</span>}
              {canEdit && !r.undoneAt && !r.undoOf && (
                <button className="ml-auto hidden group-hover:flex [@media(hover:none)]:flex items-center gap-1 hover:text-ink" onClick={() => undo.mutate(r.id)}><Undo2 size={11} /> {t('Отменить')}</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SettingsDialog({ open, onOpenChange, familyName, providers }: { open: boolean; onOpenChange: (v: boolean) => void; familyName: string; providers: { google: boolean; yandex: boolean } }) {
  const { t, me, lang } = useApp()
  const isOwner = me.role === 'owner'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl sm:max-w-xl">
        <DialogTitle className="font-serif font-medium text-lg">{t('Настройки')}</DialogTitle>
        <Tabs defaultValue={isOwner ? 'access' : 'data'}>
          <TabsList className="bg-muted">
            {isOwner && <TabsTrigger value="access">{t('Приглашения')}</TabsTrigger>}
            {isOwner && <TabsTrigger value="archive">{t('Семейный архив')}</TabsTrigger>}
            {isOwner && <TabsTrigger value="ai">{t('Нейросеть')}</TabsTrigger>}
            <TabsTrigger value="data">{t('Импорт и экспорт')}</TabsTrigger>
          </TabsList>
          {isOwner && <TabsContent value="access"><Access /></TabsContent>}
          {isOwner && <TabsContent value="archive"><Archive familyName={familyName} lang={lang} /></TabsContent>}
          {isOwner && <TabsContent value="ai"><TokensTab /></TabsContent>}
          <TabsContent value="data"><DataTab /></TabsContent>
        </Tabs>
        {(providers.google || providers.yandex) && (
          <div className="flex gap-2 border-t border-border pt-3 flex-wrap">
            {providers.google && <button className="bar-btn border border-border" onClick={() => linkAccount('/api/auth/link-social', { provider: 'google', callbackURL: '/' })}>{t('Привязать Google')}</button>}
            {providers.yandex && <button className="bar-btn border border-border" onClick={() => linkAccount('/api/auth/oauth2/link', { providerId: 'yandex', callbackURL: '/' })}>{t('Привязать Яндекс ID')}</button>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

async function linkAccount(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (j.url) location.href = j.url
}

const ROLES: Role[] = ['editor', 'reader', 'owner']
const roleName: Record<Role, string> = { owner: 'владелец', editor: 'редактор', reader: 'читатель' }

function Access() {
  const { t, me } = useApp()
  const qc = useQueryClient()
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<{ id: string; name: string; role: Role; personId: string | null }[]>('users') })
  const { data: invites = [] } = useQuery({ queryKey: ['invites'], queryFn: () => api<{ id: string; name: string; role: Role }[]>('invites') })
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [personId, setPersonId] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const { byId } = useApp()
  const refresh = () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['invites'] }) }
  const makeLink = async (json: unknown) => {
    const { token } = await api<{ token: string }>('invites', { json })
    setLink(`${location.origin}/invite/${token}`)
    setCopied(false)
    refresh()
  }
  const person = personId ? byId.get(personId) : null
  return (
    <div className="flex flex-col gap-4 pt-2 text-[13px]">
      <form className="flex flex-col gap-2" onSubmit={async (e) => { e.preventDefault(); if (name.trim()) { await makeLink({ name: name.trim(), role, personId }); setName(''); setPersonId(null) } }}>
        <div className="flex gap-2">
          <input className="h-9 flex-1 min-w-0 rounded-lg border border-input bg-white px-3" placeholder={t('Как зовут')} value={name} onChange={(e) => setName(e.target.value)} />
          <select className="h-9 rounded-lg border border-input bg-white px-2" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{t(roleName[r])}</option>)}
          </select>
          <PersonPopover onPick={setPersonId}>
            <button type="button" className="h-9 max-w-36 truncate rounded-lg border border-input bg-white px-2 text-ink-soft">{person ? personName(person) : t('Это я')}</button>
          </PersonPopover>
          <button className="h-9 px-3 rounded-lg bg-ink text-white whitespace-nowrap" disabled={!name.trim()}>{t('Создать ссылку')}</button>
        </div>
        {link && (
          <div className="flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5">
            <code className="truncate text-xs flex-1">{link}</code>
            <button type="button" className="flex items-center gap-1 text-xs hover:text-ink text-ink-soft" onClick={() => { navigator.clipboard.writeText(link); setCopied(true) }}>{copied ? <Check size={13} /> : <Copy size={13} />}{t(copied ? 'Скопировано' : 'Скопировать')}</button>
          </div>
        )}
      </form>
      <section>
        <h4 className="text-xs text-ink-faint mb-1">{t('Люди с доступом')}</h4>
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-2 py-1">
            <span className="truncate flex-1">{u.name}</span>
            <button className="text-xs text-ink-soft hover:text-ink" onClick={() => makeLink({ name: u.name, role: u.role, userId: u.id })}>{t('Новая ссылка для входа')}</button>
            {u.id === me.id ? <span className="text-ink-faint text-xs">{t(roleName[u.role])}</span> : (
              <>
                <select className="bg-transparent text-xs text-ink-soft" value={u.role} onChange={async (e) => { await api(`users/${u.id}`, { method: 'PATCH', json: { role: e.target.value } }); refresh() }}>
                  {ROLES.map((r) => <option key={r} value={r}>{t(roleName[r])}</option>)}
                </select>
                <button className="text-ink-faint hover:text-destructive" title={t('Удалить')} onClick={async () => { await api(`users/${u.id}`, { method: 'DELETE' }); refresh() }}><Trash2 size={13} /></button>
              </>
            )}
          </div>
        ))}
      </section>
      {invites.length > 0 && (
        <section>
          <h4 className="text-xs text-ink-faint mb-1">{t('Приглашения')}</h4>
          {invites.map((i) => (
            <div key={i.id} className="flex items-center gap-2 py-1">
              <span className="truncate flex-1">{i.name}</span>
              <span className="text-xs text-ink-faint">{t(roleName[i.role])}</span>
              <button className="text-ink-faint hover:text-destructive" title={t('Удалить')} onClick={async () => { await api(`invites/${i.id}`, { method: 'DELETE' }); refresh() }}><X size={13} /></button>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function Archive({ familyName, lang }: { familyName: string; lang: Lang }) {
  const { t } = useApp()
  const [name, setName] = useState(familyName)
  const save = (json: unknown) => api('settings', { method: 'PATCH', json }).then(() => location.reload())
  return (
    <div className="flex flex-col gap-3 pt-2 text-[13px]">
      <label className="flex flex-col gap-1 text-ink-soft">{t('Название семьи')}
        <input className="h-9 rounded-lg border border-input bg-white px-3 text-ink" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== familyName && name && save({ familyName: name })} />
      </label>
      <label className="flex flex-col gap-1 text-ink-soft">{t('Язык')}
        <select className="h-9 rounded-lg border border-input bg-white px-2 text-ink" value={lang} onChange={(e) => save({ language: e.target.value })}>
          <option value="ru">Русский</option><option value="en">English</option>
        </select>
      </label>
    </div>
  )
}

function DataTab() {
  const { t, canEdit } = useApp()
  const [hide, setHide] = useState(true)
  const [importing, setImporting] = useState(false)
  return (
    <div className="flex flex-col gap-4 pt-2 text-[13px]">
      <div className="flex items-center gap-3">
        <a className="bar-btn border border-border" href={`/api/v1/gedcom/export?living=${hide ? 'hide' : 'show'}`}>{t('Экспорт GEDCOM')}</a>
        <label className="flex items-center gap-2 text-ink-soft"><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> {t('Скрыть живых при экспорте')}</label>
      </div>
      {canEdit && (
        <>
          <button className="bar-btn border border-border self-start" onClick={() => setImporting(true)}><Upload size={14} /> {t('Импорт')}: GEDCOM, Excel, CSV, JSON</button>
          <ImportDialog open={importing} onOpenChange={setImporting} />
        </>
      )}
    </div>
  )
}
